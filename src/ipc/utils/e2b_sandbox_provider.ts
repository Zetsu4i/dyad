import { Sandbox } from "e2b";
import type { CommandHandle } from "e2b";
import log from "electron-log";
import path from "node:path";
import { readFileSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { readSettings } from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";
import { isE2bSandboxConfigured } from "@/lib/schemas";
import type {
  CloudSandboxFileMap,
  CloudSandboxProvider,
  CloudSandboxShareLink,
  CloudSandboxStatus,
} from "./cloud_sandbox_provider";

const logger = log.scope("e2b_sandbox_provider");

/**
 * E2B-backed implementation of Dyad's CloudSandboxProvider.
 *
 * The app's local filesystem (~/dyad-apps/<app>) stays the durable source of
 * truth: every file mutation already funnels through the cloud-sandbox sync
 * queue (queueCloudSandboxSnapshotSync), which uploads into this sandbox.
 *
 * Lifecycle (mirrors the E2B primitives, no pretend snapshots):
 * - OPEN   → connect() to a stored sandboxId (auto-resumes a paused sandbox,
 *            filesystem + node_modules intact) or create() a fresh one.
 * - WORK   → files sync in; install + dev-server run as sandbox commands;
 *            preview is served through the public getHost(port) URL.
 * - LEAVE  → pause() — persists the sandbox without compute billing.
 * - TIMEOUT safety → sandboxes are created with onTimeout: "pause" so an
 *   abandoned session never bills indefinitely.
 */

const E2B_APP_DIR = "/home/user/app";
export const E2B_DEV_PORT = 3000;
const E2B_DEFAULT_TEMPLATE = "base";
// Working-session safety net. 60 minutes of wall clock; on expiry the sandbox
// auto-pauses (onTimeout: "pause") instead of dying. Active use keeps it
// extended via touchE2bSandbox().
const E2B_DEFAULT_TIMEOUT_MINUTES = 60;
const E2B_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const E2B_PREPARE_TIMEOUT_MS = 5 * 60 * 1000;
const E2B_LOG_BUFFER_LIMIT = 2000;

export class E2bConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2bConfigurationError";
  }
}

type E2bSandboxContext = {
  sandbox: Sandbox;
  sandboxId: string;
  appId: number;
  appPath: string;
  installCommand: string;
  startCommand: string;
  /** True once install+dev-server boot ran for this sandbox session. */
  bootstrapped: boolean;
  bootstrapPromise: Promise<void> | null;
  devHandle: CommandHandle | null;
  logBuffer: string[];
  logWaiters: Array<() => void>;
  lastError: string | null;
  lastErrorAt: number | null;
  createdAt: number;
  lastActiveAt: number;
};

type E2bSandboxRecord = {
  appId: number;
  sandboxId: string;
  updatedAt: number;
};

const contextsBySandboxId = new Map<string, E2bSandboxContext>();
const contextsByAppId = new Map<number, E2bSandboxContext>();

function e2bSidecarPath(): string {
  return path.join(getUserDataPath(), "e2b-sandboxes.json");
}

async function readSidecar(): Promise<Map<number, E2bSandboxRecord>> {
  const map = new Map<number, E2bSandboxRecord>();
  try {
    const raw = await fsPromises.readFile(e2bSidecarPath(), "utf-8");
    const parsed = JSON.parse(raw) as E2bSandboxRecord[];
    for (const record of parsed) {
      map.set(record.appId, record);
    }
  } catch {
    // Missing/corrupt sidecar — start fresh (local files are the source of truth).
  }
  return map;
}

async function writeSidecar(map: Map<number, E2bSandboxRecord>): Promise<void> {
  const records = [...map.values()].sort((a, b) => a.appId - b.appId);
  await fsPromises.writeFile(
    e2bSidecarPath(),
    JSON.stringify(records, null, 2),
    "utf-8",
  );
}

export function getE2bApiKey(): string {
  const settings = readSettings();
  const apiKey = settings.e2b?.apiKey?.value;
  if (!apiKey) {
    throw new E2bConfigurationError(
      "E2B API key is not configured. Add your E2B API key in Settings → E2B Sandboxes to run apps in remote sandboxes.",
    );
  }
  return apiKey;
}

export function isE2bRuntimeModeActive(): boolean {
  return readSettings().runtimeMode2 === "e2b";
}

function pushLog(context: E2bSandboxContext, message: string): void {
  for (const line of message.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    context.logBuffer.push(line);
  }
  if (context.logBuffer.length > E2B_LOG_BUFFER_LIMIT) {
    context.logBuffer.splice(0, context.logBuffer.length - E2B_LOG_BUFFER_LIMIT);
  }
  const waiters = context.logWaiters;
  context.logWaiters = [];
  for (const waiter of waiters) {
    waiter();
  }
}

/**
 * Reads the app's package.json (local disk is the source of truth) to build
 * dev-server commands that bind 0.0.0.0 and a fixed port so the E2B public
 * URL can route to the preview.
 */
function resolveE2bCommands(input: {
  appPath: string;
  installCommand?: string | null;
  startCommand?: string | null;
}): { installCommand: string; startCommand: string } {
  const port = E2B_DEV_PORT;
  let devScript = "";
  try {
    const pkgRaw = readFileSync(
      path.join(input.appPath, "package.json"),
      "utf-8",
    );
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    devScript = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";
  } catch {
    // No package.json (General-mode projects may not have one).
  }

  const installCommand =
    input.installCommand?.trim() ||
    `pnpm install --no-frozen-lockfile --reporter=append-only`;
  const wrappedInstall = `cd ${E2B_APP_DIR} && ${installCommand}`;

  let startCommand: string;
  if (input.startCommand?.trim()) {
    startCommand = `cd ${E2B_APP_DIR} && PORT=${port} HOST=0.0.0.0 ${input.startCommand.trim()}`;
  } else if (devScript.includes("vite")) {
    startCommand = `cd ${E2B_APP_DIR} && pnpm run dev -- --host 0.0.0.0 --port ${port} --strictPort`;
  } else if (devScript.includes("next")) {
    startCommand = `cd ${E2B_APP_DIR} && pnpm run dev -- -H 0.0.0.0 -p ${port}`;
  } else if (devScript.includes("expo")) {
    startCommand = `cd ${E2B_APP_DIR} && EXPO_NO_TELEMETRY=1 pnpm exec expo start --web --port ${port}`;
  } else if (devScript) {
    startCommand = `cd ${E2B_APP_DIR} && PORT=${port} HOST=0.0.0.0 pnpm run dev`;
  } else {
    // No dev script — keep the sandbox alive without a dev server (General mode).
    startCommand = `echo '[dyad-e2b] No dev server configured for this project. Use run_command / the E2B console to execute commands.'`;
  }

  return { installCommand: wrappedInstall, startCommand };
}

async function prepareToolchain(sandbox: Sandbox): Promise<void> {
  // The E2B "base" template ships Node + npm but not pnpm. Install it once
  // per sandbox; pnpm installs are cached across pause/resume cycles because
  // the filesystem persists.
  const result = await sandbox.commands.run(
    "pnpm --version 2>/dev/null || npm install -g pnpm@9 --no-audit --no-fund >/dev/null 2>&1; pnpm --version",
    { timeoutMs: E2B_PREPARE_TIMEOUT_MS, cwd: "/home/user" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to prepare the pnpm toolchain inside the E2B sandbox (exit ${result.exitCode}): ${
        result.error ?? result.stderr.slice(-500)
      }`,
    );
  }
  logger.info(`E2B sandbox toolchain ready (pnpm ${result.stdout.trim()}).`);
}

async function bootstrapSandbox(context: E2bSandboxContext): Promise<void> {
  pushLog(context, "[dyad-e2b] Preparing sandbox toolchain (pnpm)...");
  await prepareToolchain(context.sandbox);

  pushLog(context, `[dyad-e2b] Installing dependencies: ${context.installCommand}`);
  const installResult = await context.sandbox.commands.run(
    context.installCommand,
    {
      timeoutMs: E2B_INSTALL_TIMEOUT_MS,
      cwd: E2B_APP_DIR,
      onStdout: (chunk) => pushLog(context, chunk),
      onStderr: (chunk) => pushLog(context, chunk),
    },
  );
  if (installResult.exitCode !== 0) {
    const tail = context.logBuffer.slice(-30).join("\n");
    throw new Error(
      `Dependency installation failed inside the E2B sandbox (exit code ${installResult.exitCode}).\n\nLast output:\n${tail}`,
    );
  }
  pushLog(
    context,
    `[dyad-e2b] Dependencies installed. Starting dev server on port ${E2B_DEV_PORT}...`,
  );
  await startDevServer(context);
  context.bootstrapped = true;
}

async function startDevServer(context: E2bSandboxContext): Promise<void> {
  // A paused→resumed sandbox restores the previous filesystem; make sure a
  // stale dev server from the previous session is not still holding the port.
  await context.sandbox.commands.run(
    `lsof -t -i:${E2B_DEV_PORT} 2>/dev/null | xargs -r kill -9 || true`,
    { timeoutMs: 15_000, cwd: E2B_APP_DIR },
  );
  const handle = await context.sandbox.commands.run(context.startCommand, {
    background: true,
    cwd: E2B_APP_DIR,
    onStdout: (chunk) => pushLog(context, chunk),
    onStderr: (chunk) => pushLog(context, chunk),
  });
  context.devHandle = handle;
  // The handle keeps streaming until the dev server exits; surface exits.
  void handle.wait().then((result) => {
    if (context.devHandle === handle && result.exitCode !== 0) {
      const message = `Dev server exited (code ${result.exitCode})${result.error ? `: ${result.error}` : ""}`;
      pushLog(context, `[dyad-e2b] ${message}`);
      context.lastError = message;
      context.lastErrorAt = Date.now();
    }
  });
}

function touchE2bSandbox(context: E2bSandboxContext): void {
  context.lastActiveAt = Date.now();
  // Best-effort keep-alive extension so an actively used sandbox does not
  // hit its wall-clock timeout. Failures are non-fatal (timeout would pause,
  // not kill).
  const timeoutMinutes =
    readSettings().e2b?.timeoutMinutes ?? E2B_DEFAULT_TIMEOUT_MINUTES;
  void context.sandbox
    .setTimeout(timeoutMinutes * 60 * 1000)
    .catch(() => undefined);
}

function toWriteData(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart]);
}

async function listE2bSandboxes(
  apiKey: string,
): Promise<Array<{ sandboxId: string; state: string; metadata: Record<string, string> }>> {
  const paginator = Sandbox.list({ apiKey });
  const results: Array<{
    sandboxId: string;
    state: string;
    metadata: Record<string, string>;
  }> = [];
  while (paginator.hasNext) {
    const page = await paginator.nextItems();
    for (const info of page) {
      results.push({
        sandboxId: info.sandboxId,
        state: info.state,
        metadata: info.metadata ?? {},
      });
    }
  }
  return results;
}

class E2bCloudSandboxProvider implements CloudSandboxProvider {
  name = "e2b";

  async createSandbox(input: {
    appId: number;
    appPath: string;
    installCommand?: string | null;
    startCommand?: string | null;
  }): Promise<{
    sandboxId: string;
    previewUrl: string;
    previewAuthToken: string;
  }> {
    const apiKey = getE2bApiKey();
    const template =
      readSettings().e2b?.sandboxTemplate?.trim() || E2B_DEFAULT_TEMPLATE;
    const timeoutMinutes =
      readSettings().e2b?.timeoutMinutes ?? E2B_DEFAULT_TIMEOUT_MINUTES;

    // Drop any stale in-memory context for this app (previous run).
    const stale = contextsByAppId.get(input.appId);
    if (stale) {
      contextsBySandboxId.delete(stale.sandboxId);
      contextsByAppId.delete(input.appId);
    }

    let sandbox: Sandbox;
    let resumed = false;
    const sidecar = await readSidecar();
    const stored = sidecar.get(input.appId);
    if (stored) {
      try {
        sandbox = await Sandbox.connect(stored.sandboxId, { apiKey });
        await sandbox.setTimeout(timeoutMinutes * 60 * 1000);
        resumed = true;
        logger.info(
          `Resumed E2B sandbox ${stored.sandboxId} for app ${input.appId}.`,
        );
      } catch (error) {
        logger.warn(
          `Could not resume E2B sandbox ${stored.sandboxId} for app ${input.appId} (${error}). Creating a fresh sandbox and re-uploading files.`,
        );
        sandbox = await Sandbox.create({
          apiKey,
          template,
          timeoutMs: timeoutMinutes * 60 * 1000,
          metadata: { dyadAppId: String(input.appId) },
        });
        sidecar.delete(input.appId);
        await writeSidecar(sidecar);
      }
    } else {
      sandbox = await Sandbox.create({
        apiKey,
        template,
        timeoutMs: timeoutMinutes * 60 * 1000,
        metadata: { dyadAppId: String(input.appId) },
        // Safety net: an abandoned session auto-pauses (persisting the
        // filesystem, stopping compute billing) instead of being killed.
        lifecycle: { onTimeout: "pause" },
      });
    }

    if (!resumed) {
      sidecar.set(input.appId, {
        appId: input.appId,
        sandboxId: sandbox.sandboxId,
        updatedAt: Date.now(),
      });
      await writeSidecar(sidecar);
    }

    const commands = resolveE2bCommands({
      appPath: input.appPath,
      installCommand: input.installCommand,
      startCommand: input.startCommand,
    });

    const context: E2bSandboxContext = {
      sandbox,
      sandboxId: sandbox.sandboxId,
      appId: input.appId,
      appPath: input.appPath,
      installCommand: commands.installCommand,
      startCommand: commands.startCommand,
      bootstrapped: false,
      bootstrapPromise: null,
      devHandle: null,
      logBuffer: [],
      logWaiters: [],
      lastError: null,
      lastErrorAt: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    if (resumed) {
      pushLog(
        context,
        `[dyad-e2b] Resumed sandbox ${sandbox.sandboxId} — filesystem and dependencies are preserved.`,
      );
    } else {
      pushLog(context, `[dyad-e2b] Created sandbox ${sandbox.sandboxId}.`);
    }
    contextsBySandboxId.set(context.sandboxId, context);
    contextsByAppId.set(input.appId, context);
    touchE2bSandbox(context);

    return {
      sandboxId: context.sandboxId,
      previewUrl: sandbox.getHost(E2B_DEV_PORT),
      // E2B public preview URLs need no bearer token; a non-empty placeholder
      // satisfies the cloud-sandbox contract. The proxy only attaches
      // Authorization for the engine ("cloud") runtime mode.
      previewAuthToken: "e2b-public-preview",
    };
  }

  async uploadFiles(
    sandboxId: string,
    files: CloudSandboxFileMap,
    options?: { replaceAll?: boolean; deletedFiles?: string[] },
  ): Promise<{ previewUrl?: string; previewAuthToken?: string }> {
    const context = await this.requireContext(sandboxId);
    touchE2bSandbox(context);

    const entries = Object.entries(files).map(([relativePath, bytes]) => ({
      path: path.posix.join(E2B_APP_DIR, relativePath),
      data: toWriteData(bytes),
    }));

    if (options?.replaceAll) {
      await context.sandbox.commands.run(
        `rm -rf ${E2B_APP_DIR} && mkdir -p ${E2B_APP_DIR}`,
        { timeoutMs: 60_000 },
      );
    } else {
      for (const deletedPath of options?.deletedFiles ?? []) {
        await context.sandbox.files
          .remove(path.posix.join(E2B_APP_DIR, deletedPath))
          .catch(() => undefined);
      }
    }

    // Write in batches so very large file maps do not produce oversized requests.
    const BATCH_SIZE = 150;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await context.sandbox.files.write(batch);
    }

    if (options?.replaceAll && !context.bootstrapped) {
      // The initial full snapshot is in place — install deps and boot the dev
      // server. Awaited so run failures surface as startup errors with logs.
      if (!context.bootstrapPromise) {
        context.bootstrapPromise = bootstrapSandbox(context)
          .then(() => {
            context.bootstrapPromise = null;
          })
          .catch((error) => {
            context.bootstrapPromise = null;
            context.lastError =
              error instanceof Error ? error.message : String(error);
            context.lastErrorAt = Date.now();
            throw error;
          });
      }
      await context.bootstrapPromise;
    }

    return {};
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const context = contextsBySandboxId.get(sandboxId);
    if (!context) {
      // Unknown locally — still try to pause it via the API (idempotent no-op
      // if it is already gone).
      try {
        await Sandbox.pause(sandboxId, { apiKey: getE2bApiKey() });
      } catch {
        // Already gone or unreachable — nothing to do.
      }
      return;
    }
    try {
      await context.devHandle?.kill().catch(() => undefined);
    } catch {
      // ignore
    }
    try {
      // Pause = persist filesystem, stop compute billing. The sandbox can be
      // resumed on the next open (files + node_modules survive).
      await context.sandbox.pause();
      logger.info(
        `Paused E2B sandbox ${sandboxId} for app ${context.appId} (state persisted, compute billing stopped).`,
      );
    } catch (error) {
      logger.warn(
        `Failed to pause E2B sandbox ${sandboxId}: ${error}. Falling back to kill().`,
      );
      try {
        await context.sandbox.kill();
        const sidecar = await readSidecar();
        sidecar.delete(context.appId);
        await writeSidecar(sidecar);
      } catch (killError) {
        logger.warn(
          `Failed to kill E2B sandbox ${sandboxId} after pause failure: ${killError}`,
        );
      }
    } finally {
      const waiters = context.logWaiters;
      context.logWaiters = [];
      for (const waiter of waiters) {
        waiter();
      }
      contextsBySandboxId.delete(sandboxId);
      if (contextsByAppId.get(context.appId)?.sandboxId === sandboxId) {
        contextsByAppId.delete(context.appId);
      }
    }
  }

  async *streamLogs(
    sandboxId: string,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const context = contextsBySandboxId.get(sandboxId);
    if (!context) {
      return;
    }
    let cursor = 0;
    while (true) {
      if (signal?.aborted) {
        return;
      }
      if (cursor >= context.logBuffer.length) {
        if (!contextsBySandboxId.has(sandboxId)) {
          return;
        }
        await new Promise<void>((resolve) => {
          const waiter = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(waiter, 1000);
          context.logWaiters.push(waiter);
        });
        continue;
      }
      const line = context.logBuffer[cursor];
      cursor += 1;
      yield line;
    }
  }

  async restartSandbox(
    sandboxId: string,
  ): Promise<{ previewUrl: string; previewAuthToken: string }> {
    const context = await this.requireContext(sandboxId);
    touchE2bSandbox(context);
    try {
      await context.devHandle?.kill();
    } catch {
      // ignore
    }
    context.devHandle = null;
    await startDevServer(context);
    return {
      previewUrl: context.sandbox.getHost(E2B_DEV_PORT),
      previewAuthToken: "e2b-public-preview",
    };
  }

  async getStatus(sandboxId: string): Promise<CloudSandboxStatus> {
    const context = contextsBySandboxId.get(sandboxId);
    const now = new Date().toISOString();
    let running = false;
    let found = true;
    try {
      const apiKey = getE2bApiKey();
      const sandboxes = await listE2bSandboxes(apiKey);
      const match = sandboxes.find(
        (candidate) => candidate.sandboxId === sandboxId,
      );
      running = match?.state === "running";
      found = !!match;
    } catch {
      // If listing fails, fall back to the local context.
      running = !!context;
    }
    const appStatus: CloudSandboxStatus["appStatus"] = !found
      ? "failed"
      : running
        ? context?.bootstrapped
          ? "running"
          : "starting"
        : "standby";
    return {
      sandboxId,
      status: !found ? "stopped" : running ? "running" : "paused",
      previewUrl: context
        ? context.sandbox.getHost(E2B_DEV_PORT)
        : `https://${E2B_DEV_PORT}-${sandboxId}.e2b.app`,
      previewAuthToken: "e2b-public-preview",
      previewPort: E2B_DEV_PORT,
      syncRevision: 0,
      initialSyncCompleted: true,
      appStatus,
      syncAgentHealthy: true,
      createdAt: context?.createdAt
        ? new Date(context.createdAt).toISOString()
        : now,
      lastActiveAt: context?.lastActiveAt
        ? new Date(context.lastActiveAt).toISOString()
        : now,
      lastSuccessfulSyncAt: now,
      expiresAt: now,
      billingState: !found ? "terminated" : running ? "active" : "terminated",
      billingStartedAt: context?.createdAt
        ? new Date(context.createdAt).toISOString()
        : now,
      billingLockedAt: null,
      lastChargedAt: null,
      nextChargeAt: now,
      billingSlicesCharged: 0,
      creditsCharged: 0,
      terminationReason: null,
      lastErrorCode: context?.lastError ? "e2b_error" : null,
      lastErrorMessage: context?.lastError ?? null,
    };
  }

  async createShareLink(
    sandboxId: string,
    _options?: { expiresInSeconds?: number },
  ): Promise<CloudSandboxShareLink> {
    const expiresAt = new Date(
      Date.now() + (_options?.expiresInSeconds ?? 24 * 60 * 60) * 1000,
    ).toISOString();
    return {
      sandboxId,
      shareLinkId: "e2b-public-url",
      url: `https://${E2B_DEV_PORT}-${sandboxId}.e2b.app`,
      expiresAt,
    };
  }

  private async requireContext(
    sandboxId: string,
  ): Promise<E2bSandboxContext> {
    const context = contextsBySandboxId.get(sandboxId);
    if (context) {
      return context;
    }
    throw new E2bConfigurationError(
      `E2B sandbox ${sandboxId} is not attached in this session. Restart the app preview to re-create it.`,
    );
  }
}

export const e2bCloudSandboxProvider = new E2bCloudSandboxProvider();

/**
 * Runs a shell command inside the app's E2B sandbox. Used by the agent's
 * run_command tool and the sandbox console. Flushing pending file syncs is
 * the caller's responsibility (syncCloudSandboxDirtyPaths).
 */
export async function runE2bCommandForApp(
  appId: number,
  command: string,
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const context = contextsByAppId.get(appId);
  if (!context) {
    throw new E2bConfigurationError(
      "This app has no running E2B sandbox. Start the app preview first (Run button).",
    );
  }
  touchE2bSandbox(context);
  const result = await context.sandbox.commands.run(command, {
    timeoutMs,
    cwd: E2B_APP_DIR,
    envs: { DYAD_APP_DIR: E2B_APP_DIR },
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

/** Is this app currently attached to a live E2B sandbox session? */
export function hasRunningE2bSandboxForApp(appId: number): boolean {
  return contextsByAppId.has(appId);
}

/**
 * Startup reconciliation: pause/kill any E2B sandboxes that belong to Dyad
 * (metadata dyadAppId) but are not attached in this session (e.g. after a
 * crash). Sandboxes already in "running" state from an orphaned session keep
 * billing — those get killed; paused ones are left for fast resume.
 */
export async function reconcileE2bSandboxes(): Promise<string[]> {
  if (!isE2bSandboxConfigured(readSettings())) {
    return [];
  }
  try {
    const apiKey = getE2bApiKey();
    const sandboxes = await listE2bSandboxes(apiKey);
    const handled: string[] = [];
    for (const sandbox of sandboxes) {
      if (!sandbox.metadata?.dyadAppId) {
        continue;
      }
      const appId = Number(sandbox.metadata.dyadAppId);
      if (contextsByAppId.has(appId)) {
        continue;
      }
      if (sandbox.state === "running") {
        await Sandbox.pause(sandbox.sandboxId, { apiKey }).catch(() =>
          Sandbox.kill(sandbox.sandboxId, { apiKey }).catch(() => undefined),
        );
        handled.push(sandbox.sandboxId);
        logger.info(
          `Reconciled orphaned running E2B sandbox ${sandbox.sandboxId} (app ${appId}) → paused.`,
        );
      }
    }
    return handled;
  } catch (error) {
    logger.warn(`E2B sandbox reconciliation failed: ${error}`);
    return [];
  }
}
