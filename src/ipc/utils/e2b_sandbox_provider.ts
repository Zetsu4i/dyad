/**
 * E2B cloud sandbox provider for the Dyad web runtime.
 *
 * Implements dyad's `CloudSandboxProvider` interface (the seam used by
 * `executeAppInCloud` in app_runtime_service.ts) backed by E2B sandboxes:
 *
 *  - `createSandbox`   creates (or resumes a paused) E2B sandbox for the app
 *  - `uploadFiles`     writes the app's files into /app and boots the dev
 *                      server in the background (install + start, streamed)
 *  - `restartSandbox`  re-runs install + dev server
 *  - `destroySandbox`  PAUSES the sandbox (cost-saving hibernation; state,
 *                      node_modules and installed toolchain are kept)
 *  - `streamLogs`      streams install/dev-server output back to the UI
 *  - `createShareLink` the E2B public preview URL is already public
 *
 * Preview URLs use E2B's public proxy: `https://{port}-{sandboxId}.e2b.app`.
 *
 * Sandbox lifecycle: created with `lifecycle: { onTimeout: "pause" }`, so an
 * idle sandbox pauses itself. Paused sandboxes are resumed via
 * `Sandbox.connect()` on the next app run — same data, no reinstall.
 *
 * The Dyad working directory on the server stays the source of truth: every
 * write_file / git commit funnels through `queueCloudSandboxSnapshotSync`
 * which calls uploadFiles here with the changed paths.
 */
import fs from "node:fs";
import path from "node:path";
import { Sandbox, type SandboxInstance } from "e2b";
import log from "electron-log";
import { readSettings } from "@/main/settings";
import { getAppPort } from "../../../shared/ports";
import { getUserDataPath } from "@/paths/paths";
import type {
  CloudSandboxProvider,
  CloudSandboxFileMap,
  CloudSandboxShareLink,
  CloudSandboxStatus,
} from "./cloud_sandbox_provider";

const logger = log.scope("e2b_sandbox_provider");

export const E2B_APP_ROOT = "/app";
const SANDBOX_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // auto-pause after 15 min idle
const DEV_BOOT_TIMEOUT_MS = 150 * 1000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const TOOLCHAIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;
const NODE_VERSION = "v24.19.0";
const MAX_LOG_BUFFER_CHARS = 256 * 1024;

// ---------------------------------------------------------------------------
// Safe command execution
// ---------------------------------------------------------------------------

/**
 * Runs a command in a sandbox and ALWAYS resolves with
 * {exitCode, stdout, stderr} — the E2B SDK throws CommandExitError for
 * non-zero exits, which callers here usually want to inspect, not propagate.
 */
async function safeRun(
  sandbox: SandboxInstance,
  command: string,
  opts?: {
    cwd?: string;
    timeoutMs?: number;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await sandbox.commands.run(command, {
      cwd: opts?.cwd ?? E2B_APP_ROOT,
      timeoutMs: opts?.timeoutMs ?? 60_000,
      onStdout: opts?.onStdout,
      onStderr: opts?.onStderr,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const err = error as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (typeof err.exitCode === "number") {
      // CommandExitError: a real command failure — return it.
      return {
        exitCode: err.exitCode,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message ?? "",
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Settings access
// ---------------------------------------------------------------------------

export function isE2bRuntimeMode(): boolean {
  try {
    return readSettings().runtimeMode2 === "e2b";
  } catch {
    return false;
  }
}

export function getE2bApiKey(): string | undefined {
  try {
    const settings = readSettings();
    const fromSettings = settings.e2bApiKey?.value?.trim();
    if (fromSettings) return fromSettings;
  } catch {
    /* fall through to env */
  }
  return process.env.E2B_API_KEY?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Log bus — ring buffer + live subscribers per sandbox
// ---------------------------------------------------------------------------

class E2bLogBus {
  private buffer = "";
  private subscribers = new Set<(line: string) => void>();
  private closed = false;

  push(line: string): void {
    if (this.closed) return;
    const withNewline = line.endsWith("\n") ? line : `${line}\n`;
    // Mirror to the server log for observability.
    try {
      console.log(`[e2b] ${withNewline}`.trimEnd());
    } catch {
      /* logging must never break the bus */
    }
    this.buffer += withNewline;
    if (this.buffer.length > MAX_LOG_BUFFER_CHARS) {
      this.buffer = this.buffer.slice(-Math.floor(MAX_LOG_BUFFER_CHARS / 2));
    }
    for (const subscriber of this.subscribers) {
      try {
        subscriber(withNewline);
      } catch {
        /* subscriber died */
      }
    }
  }

  snapshot(): string {
    return this.buffer;
  }

  subscribe(listener: (line: string) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.subscribers.clear();
  }
}

// ---------------------------------------------------------------------------
// Registry — persists appId -> sandboxId across server restarts
// ---------------------------------------------------------------------------

interface E2bRegistryEntry {
  sandboxId: string;
  appPath: string;
  port: number;
  updatedAt: number;
}

function registryPath(): string {
  return path.join(getUserDataPath(), "e2b-sandboxes.json");
}

function readRegistry(): Record<number, E2bRegistryEntry> {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeRegistry(entries: Record<number, E2bRegistryEntry>): void {
  try {
    fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
    fs.writeFileSync(registryPath(), JSON.stringify(entries, null, 2));
  } catch (error) {
    logger.warn("Failed to persist E2B sandbox registry:", error);
  }
}

// ---------------------------------------------------------------------------
// App sandbox state
// ---------------------------------------------------------------------------

interface E2bAppState {
  appId: number;
  appPath: string;
  port: number;
  sandboxId: string;
  sandbox: SandboxInstance;
  installCommand?: string | null;
  startCommand?: string | null;
  resumed: boolean;
  toolchainReady: boolean;
  toolchainPromise: Promise<void> | null;
  bootPromise: Promise<boolean> | null;
  logBus: E2bLogBus;
  devRunning: boolean;
  lastActiveAt: number;
}

function previewUrlFor(sandboxId: string, port: number): string {
  return `https://${port}-${sandboxId}.e2b.app`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class E2bCloudSandboxProvider implements CloudSandboxProvider {
  name = "e2b";

  private states = new Map<string, E2bAppState>(); // by sandboxId
  private byAppId = new Map<number, string>(); // appId -> sandboxId

  // ------------------------------------------------------------- create

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
    if (!apiKey) {
      throw new Error(
        "E2B API key is not configured. Add it in Settings → E2B Sandbox.",
      );
    }

    const port = getAppPort(input.appId);

    // 1. Live in-memory handle for this app — reuse it.
    const liveId = this.byAppId.get(input.appId);
    if (liveId) {
      const live = this.states.get(liveId);
      if (live) {
        live.installCommand = input.installCommand ?? live.installCommand;
        live.startCommand = input.startCommand ?? live.startCommand;
        live.lastActiveAt = Date.now();
        void this.ensureBooted(live);
        return {
          sandboxId: live.sandboxId,
          previewUrl: previewUrlFor(live.sandboxId, live.port),
          previewAuthToken: "e2b",
        };
      }
      this.byAppId.delete(input.appId);
    }

    // 2. A paused sandbox from an earlier session — resume it (keeps
    //    node_modules + toolchain; no reinstall needed).
    const registry = readRegistry();
    const existing = registry[input.appId];
    if (existing?.sandboxId) {
      try {
        const sandbox = await Sandbox.connect(existing.sandboxId, { apiKey });
        const state: E2bAppState = {
          appId: input.appId,
          appPath: input.appPath,
          port,
          sandboxId: sandbox.sandboxId,
          sandbox,
          installCommand: input.installCommand,
          startCommand: input.startCommand,
          resumed: true,
          toolchainReady: false,
          toolchainPromise: null,
          bootPromise: null,
          logBus: new E2bLogBus(),
          devRunning: false,
          lastActiveAt: Date.now(),
        };
        this.states.set(state.sandboxId, state);
        this.byAppId.set(input.appId, state.sandboxId);
        state.logBus.push(
          `[e2b] Resumed sandbox ${sandbox.sandboxId} for app ${input.appId} (data preserved)\n`,
        );
        void this.ensureBooted(state);
        return {
          sandboxId: state.sandboxId,
          previewUrl: previewUrlFor(state.sandboxId, state.port),
          previewAuthToken: "e2b",
        };
      } catch (error) {
        logger.warn(
          `Failed to resume E2B sandbox ${existing.sandboxId}; creating a fresh one:`,
          error,
        );
        delete registry[input.appId];
        writeRegistry(registry);
      }
    }

    // 3. Fresh sandbox.
    const sandbox = await Sandbox.create({
      apiKey,
      timeoutMs: SANDBOX_IDLE_TIMEOUT_MS,
      lifecycle: { onTimeout: "pause", autoResume: true },
      metadata: { dyadAppId: String(input.appId) },
    });

    const state: E2bAppState = {
      appId: input.appId,
      appPath: input.appPath,
      port,
      sandboxId: sandbox.sandboxId,
      sandbox,
      installCommand: input.installCommand,
      startCommand: input.startCommand,
      resumed: false,
      toolchainReady: false,
      toolchainPromise: null,
      bootPromise: null,
      logBus: new E2bLogBus(),
      devRunning: false,
      lastActiveAt: Date.now(),
    };
    this.states.set(state.sandboxId, state);
    this.byAppId.set(input.appId, state.sandboxId);

    const updated = readRegistry();
    updated[input.appId] = {
      sandboxId: sandbox.sandboxId,
      appPath: input.appPath,
      port,
      updatedAt: Date.now(),
    };
    writeRegistry(updated);

    state.logBus.push(
      `[e2b] Created sandbox ${sandbox.sandboxId} for app ${input.appId}\n`,
    );

    return {
      sandboxId: sandbox.sandboxId,
      previewUrl: previewUrlFor(sandbox.sandboxId, port),
      previewAuthToken: "e2b",
    };
  }

  // ------------------------------------------------------------- upload

  async uploadFiles(
    sandboxId: string,
    files: CloudSandboxFileMap,
    options?: { replaceAll?: boolean; deletedFiles?: string[] },
  ): Promise<{ previewUrl?: string; previewAuthToken?: string }> {
    const state = this.states.get(sandboxId);
    if (!state) {
      throw new Error(`E2B sandbox ${sandboxId} is not active`);
    }
    state.lastActiveAt = Date.now();

    const entries = Object.entries(files);
    if (entries.length > 0) {
      // Write in batches of 200 files to keep requests bounded.
      for (let i = 0; i < entries.length; i += 200) {
        const batch = entries.slice(i, i + 200).map(([relPath, data]) => ({
          path: path.posix.join(E2B_APP_ROOT, relPath),
          data,
        }));
        await state.sandbox.files.write(batch);
      }
      state.logBus.push(
        `[e2b] Synced ${entries.length} file(s) to sandbox\n`,
      );
    }

    const deleted = options?.deletedFiles ?? [];
    for (const relPath of deleted) {
      try {
        await state.sandbox.files.remove(
          path.posix.join(E2B_APP_ROOT, relPath),
        );
      } catch {
        /* already gone */
      }
    }

    if (options?.replaceAll) {
      // Initial snapshot upload: kick off install + dev server in the
      // background. Output streams through streamLogs().
      void this.ensureBooted(state);
    }

    return {};
  }

  // ------------------------------------------------------------- restart

  async restartSandbox(
    sandboxId: string,
  ): Promise<{ previewUrl: string; previewAuthToken: string }> {
    const state = this.states.get(sandboxId);
    if (!state) {
      throw new Error(`E2B sandbox ${sandboxId} is not active`);
    }
    state.lastActiveAt = Date.now();
    state.logBus.push(`[e2b] Restarting dev server...\n`);
    await this.killDevServer(state);
    state.devRunning = false;
    state.bootPromise = null;
    const ok = await this.ensureBooted(state);
    if (!ok) {
      state.logBus.push(`[e2b] Dev server failed to restart\n`);
    }
    return {
      previewUrl: previewUrlFor(state.sandboxId, state.port),
      previewAuthToken: "e2b",
    };
  }

  // ------------------------------------------------------------- destroy

  /**
   * Dyad calls destroySandbox when an app is stopped. For E2B this is the
   * cost-saving hibernation point: PAUSE instead of kill. The paused sandbox
   * keeps the filesystem + memory state (node_modules, toolchain) and is
   * resumed on the next app run — "shut down on leave, respawn with the same
   * data on return".
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const state = this.states.get(sandboxId);
    if (state) {
      state.lastActiveAt = Date.now();
      try {
        await this.killDevServer(state);
      } catch {
        /* best effort */
      }
      state.logBus.push(
        `[e2b] Hibernating sandbox (paused; data preserved for next run)\n`,
      );
      state.logBus.close();
    }
    try {
      await Sandbox.pause(sandboxId, { apiKey: getE2bApiKey() });
    } catch (error) {
      // Already paused / expired — not fatal.
      logger.debug(`pause(${sandboxId}) failed (likely already paused):`, error);
    }
    if (state) {
      this.states.delete(sandboxId);
      this.byAppId.delete(state.appId);
    }
  }

  /** Hard kill (app deleted). Removes the registry entry. */
  async killSandboxForApp(appId: number): Promise<void> {
    const registry = readRegistry();
    const entry = registry[appId];
    const sandboxId = entry?.sandboxId ?? this.byAppId.get(appId);
    this.byAppId.delete(appId);
    if (sandboxId) {
      this.states.delete(sandboxId);
      try {
        await Sandbox.kill(sandboxId, { apiKey: getE2bApiKey() });
      } catch {
        /* already dead */
      }
    }
    if (entry) {
      delete registry[appId];
      writeRegistry(registry);
    }
  }

  // ------------------------------------------------------------- logs

  async *streamLogs(
    sandboxId: string,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const state = this.states.get(sandboxId);
    if (!state) {
      yield `[e2b] sandbox ${sandboxId} has no live log stream\n`;
      return;
    }
    // Replay recent history first, then follow live.
    const queue: string[] = [];
    let notify: (() => void) | null = null;
    let wake: Promise<void> | null = null;

    const unsubscribe = state.logBus.subscribe((line) => {
      queue.push(line);
      notify?.();
    });

    const snapshot = state.logBus.snapshot();
    if (snapshot) {
      yield snapshot;
    }

    try {
      for (;;) {
        if (signal?.aborted) return;
        while (queue.length > 0) {
          const line = queue.shift()!;
          yield line;
        }
        if (!wake) {
          wake = new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
        const raced = await Promise.race([
          wake,
          new Promise<"aborted">((resolve) => {
            const listener = () => resolve("aborted");
            signal?.addEventListener("abort", listener, { once: true });
          }),
        ]);
        if (raced === "aborted") return;
        wake = null;
        notify = null;
      }
    } finally {
      unsubscribe();
    }
  }

  // ------------------------------------------------------------- status

  async getStatus(sandboxId: string): Promise<CloudSandboxStatus> {
    const state = this.states.get(sandboxId);
    const now = new Date().toISOString();
    const appId = state?.appId;
    const port = state?.port ?? 8080;
    const previewUrl = previewUrlFor(sandboxId, port);
    const devRunning = state?.devRunning ?? false;
    return {
      sandboxId,
      status: devRunning ? "running" : "starting",
      previewUrl,
      previewAuthToken: "e2b",
      previewPort: port,
      syncRevision: 1,
      initialSyncCompleted: true,
      appStatus: devRunning ? "running" : "starting",
      syncAgentHealthy: true,
      createdAt: now,
      lastActiveAt: now,
      lastSuccessfulSyncAt: now,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      billingState: "active",
      billingStartedAt: now,
      billingLockedAt: null,
      lastChargedAt: null,
      nextChargeAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      billingSlicesCharged: 0,
      creditsCharged: 0,
      terminationReason: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      localSyncErrorMessage: null,
    } satisfies CloudSandboxStatus;
  }

  async createShareLink(
    sandboxId: string,
    options?: { expiresInSeconds?: number },
  ): Promise<CloudSandboxShareLink> {
    const state = this.states.get(sandboxId);
    const port = state?.port ?? 8080;
    return {
      sandboxId,
      shareLinkId: sandboxId,
      url: previewUrlFor(sandboxId, port),
      expiresAt: new Date(
        Date.now() + (options?.expiresInSeconds ?? 86400) * 1000,
      ).toISOString(),
    };
  }

  // ------------------------------------------------------------- internals

  /** Get (or create) the live state for an app's sandbox. */
  getLiveStateForApp(appId: number): E2bAppState | undefined {
    const sandboxId = this.byAppId.get(appId);
    if (!sandboxId) return undefined;
    return this.states.get(sandboxId);
  }

  /** Execute a shell command in the app's sandbox (agent tools/terminal). */
  async runInSandbox(
    appId: number,
    command: string,
    opts?: { timeoutMs?: number; cwd?: string; onStdout?: (d: string) => void; onStderr?: (d: string) => void },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const state = this.getLiveStateForApp(appId);
    if (!state) {
      throw new Error(
        `No live E2B sandbox for app ${appId}. Start the app preview first.`,
      );
    }
    state.lastActiveAt = Date.now();
    return safeRun(state.sandbox, command, {
      cwd: opts?.cwd ?? E2B_APP_ROOT,
      timeoutMs: opts?.timeoutMs ?? 5 * 60_000,
      onStdout: opts?.onStdout,
      onStderr: opts?.onStderr,
    });
  }

  /** Open a real PTY in the app's sandbox (terminal panel). */
  async openPty(
    appId: number,
    opts: {
      cols: number;
      rows: number;
      onData: (data: Uint8Array) => void;
    },
  ): Promise<{
    handle: Awaited<ReturnType<SandboxInstance["pty"]["create"]>>;
    ptyModule: SandboxInstance["pty"];
    state: E2bAppState;
  }> {
    const state = this.getLiveStateForApp(appId);
    if (!state) {
      throw new Error(
        `No live E2B sandbox for app ${appId}. Start the app preview first.`,
      );
    }
    state.lastActiveAt = Date.now();
    const handle = await state.sandbox.pty.create({
      cols: opts.cols,
      rows: opts.rows,
      cwd: E2B_APP_ROOT,
      onData: opts.onData,
    });
    return { handle, ptyModule: state.sandbox.pty, state };
  }

  /** Map a server-side app working directory back to its appId. */
  findAppIdByPath(appPath: string): number | undefined {
    for (const state of this.states.values()) {
      if (state.appPath === appPath) return state.appId;
    }
    const registry = readRegistry();
    for (const [appId, entry] of Object.entries(registry)) {
      if (entry.appPath === appPath) return Number(appId);
    }
    return undefined;
  }

  private async ensureToolchain(state: E2bAppState): Promise<void> {
    if (state.toolchainReady) return;
    if (state.toolchainPromise) return state.toolchainPromise;

    state.toolchainPromise = (async () => {
      // Modern Node (E2B base image ships 20.9; dyad scaffolds need newer).
      const nodeCheck = await safeRun(
        state.sandbox,
        `node -e 'const [maj,min]=process.versions.node.split(".").map(Number); process.exit((maj>22||(maj===22&&min>=12))?0:1)'`,
        { timeoutMs: 15_000 },
      );
      if (nodeCheck.exitCode !== 0) {
        const current = await safeRun(state.sandbox, "node --version || true", {
          timeoutMs: 10_000,
        });
        state.logBus.push(
          `[e2b] Installing Node ${NODE_VERSION} (base image has ${current.stdout.trim() || "none"})...\n`,
        );
        // /usr/local/bin is writable but /usr/local/share/doc is immutable in
        // the base image, and bin/npm + bin/npx are symlinks whose extraction
        // is unreliable. The image's old node_modules must be replaced
        // wholesale (mixing old/new npm files breaks npm). Validated sequence:
        const install = await safeRun(
          state.sandbox,
          [
            `curl -fsSL https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz -o /tmp/node.tgz`,
            `tar -xzf /tmp/node.tgz -C /usr/local --strip-components=1 --no-same-owner --exclude='*/share/*' --exclude='*/include/*' 2>/dev/null`,
            `tar -xzf /tmp/node.tgz -C /usr/local --strip-components=1 --no-same-owner --wildcards '*/bin/node' 2>/dev/null`,
            `rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/yarn`,
            `mkdir -p /usr/local/lib/node_modules`,
            `tar -xzf /tmp/node.tgz -C /usr/local/lib/node_modules --strip-components=3 --no-same-owner --wildcards '*/lib/node_modules/*' 2>/dev/null`,
            `rm -f /tmp/node.tgz`,
            `chmod 755 /usr/local/bin/node 2>/dev/null`,
            `rm -f /usr/local/bin/npm /usr/local/bin/npx`,
            `ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm`,
            `ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx`,
            `node --version`,
            `npm --version`,
          ].join("; "),
          { timeoutMs: TOOLCHAIN_TIMEOUT_MS },
        );
        const after = install.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
        if (!after.startsWith("v2")) {
          state.logBus.push(
            `[e2b] Node upgrade failed: ${(install.stderr || install.stdout).slice(-300)}\n`,
          );
          throw new Error(
            `Failed to install Node ${NODE_VERSION} in the E2B sandbox`,
          );
        }
        state.logBus.push(`[e2b] Node upgraded to ${after}.\n`);
      }
      // pnpm (dyad's default install command is pnpm-based).
      const hasPnpm = await safeRun(
        state.sandbox,
        `command -v pnpm >/dev/null 2>&1 && echo ok || echo missing`,
        { timeoutMs: 10_000 },
      );
      if (hasPnpm.stdout.trim() !== "ok") {
        state.logBus.push(`[e2b] Installing pnpm...\n`);
        const pnpmInstall = await safeRun(
          state.sandbox,
          `npm install -g pnpm@9 --silent >/dev/null 2>&1; pnpm --version || echo PNPM_FAILED`,
          { timeoutMs: TOOLCHAIN_TIMEOUT_MS },
        );
        const pnpmVersion = pnpmInstall.stdout.trim().split("\n").pop() ?? "";
        if (pnpmVersion.startsWith("9.")) {
          state.logBus.push(`[e2b] pnpm ${pnpmVersion} installed.\n`);
        } else {
          state.logBus.push(
            `[e2b] pnpm install failed: ${(pnpmInstall.stderr || pnpmInstall.stdout).slice(-200)}\n`,
          );
          throw new Error("Failed to install pnpm in the E2B sandbox");
        }
      }
      state.toolchainReady = true;
    })();

    try {
      await state.toolchainPromise;
    } finally {
      state.toolchainPromise = null;
    }
  }

  private async ensureBooted(state: E2bAppState): Promise<boolean> {
    if (state.bootPromise) return state.bootPromise;

    state.bootPromise = this.bootApp(state).catch((error) => {
      state.logBus.push(`[e2b] Boot error: ${(error as Error).message}\n`);
      return false;
    });

    try {
      return await state.bootPromise;
    } finally {
      state.bootPromise = null;
    }
  }

  private async bootApp(state: E2bAppState): Promise<boolean> {
    await this.ensureToolchain(state);

    // Install (fresh sandbox or full restart). A resumed sandbox USUALLY
    // keeps node_modules (pause preserves memory state) — but a sandbox that
    // was resumed before its first install completed has none, so verify.
    let canSkipInstall = false;
    if (state.resumed) {
      const nmCheck = await safeRun(
        state.sandbox,
        `test -d ${E2B_APP_ROOT}/node_modules && ls ${E2B_APP_ROOT}/node_modules | wc -l || echo 0`,
        { timeoutMs: 15_000 },
      );
      const count = Number(nmCheck.stdout.trim().split("\n").pop() ?? "0");
      canSkipInstall = Number.isFinite(count) && count > 3;
      if (!canSkipInstall) {
        state.logBus.push(
          `[e2b] Resumed sandbox has no node_modules — running install.\n`,
        );
      }
    }
    const installCommand = state.installCommand?.trim() || "pnpm install";
    if (!canSkipInstall && installCommand) {
      state.logBus.push(`[e2b] Installing dependencies (${installCommand})...\n`);
      const install = await safeRun(
        state.sandbox,
        `cd ${E2B_APP_ROOT} && (${installCommand}) 2>&1 | tail -40`,
        { timeoutMs: INSTALL_TIMEOUT_MS },
      );
      if (install.exitCode !== 0) {
        state.logBus.push(
          `[e2b] Install failed (exit ${install.exitCode}):\n${install.stdout.slice(-2000)}\n`,
        );
        return false;
      }
      state.logBus.push(`[e2b] Dependencies installed.\n`);
    }

    // Start dev server.
    await this.killDevServer(state);
    const startCommand = this.buildStartCommand(state);
    state.logBus.push(`[e2b] Starting dev server: ${startCommand}\n`);
    await state.sandbox.commands.run(
      `cd ${E2B_APP_ROOT} && ${startCommand}`,
      {
        background: true,
        onStdout: (data) => state.logBus.push(data),
        onStderr: (data) => state.logBus.push(data),
      },
    );

    // Wait for the dev server to answer.
    const ready = await this.waitForDevServer(state);
    if (ready) {
      state.devRunning = true;
      const url = previewUrlFor(state.sandboxId, state.port);
      state.logBus.push(`[e2b] Dev server ready at ${url}\n`);
      // Emit dyad's proxy-ready protocol line: MainAppRuntimeOutput parses it
      // from the log stream and turns it into a PROXY_READY event, which
      // reloads the preview iframe onto the live URL.
      state.logBus.push(
        `[dyad-proxy-server]started=[${url}] original=[${url}] mode=[cloud]\n`,
      );
    } else {
      state.logBus.push(
        `[e2b] Dev server did not respond within ${DEV_BOOT_TIMEOUT_MS / 1000}s — check the app logs.\n`,
      );
    }
    return ready;
  }

  private buildStartCommand(state: E2bAppState): string {
    const base = state.startCommand?.trim() || "pnpm run dev";
    if (base.includes("--port") || base.includes("-p ")) {
      return base;
    }
    // pnpm forwards args after the script name directly (a `--` separator
    // would be passed through to the script binary and break vite's flag
    // parsing); npm needs the `--` separator.
    const separator = /(^|\s)(pnpm|bun|yarn)(\s|$)/.test(base) ? "" : " --";
    return `${base}${separator} --port ${state.port}`;
  }

  private async killDevServer(state: E2bAppState): Promise<void> {
    // [v]ite-style bracket trick so pkill never matches its own command line.
    const killers = [
      `pkill -f " --port ${state.port}" || true`,
      `pkill -f "[v]ite.*--port ${state.port}" || true`,
    ];
    for (const killer of killers) {
      await state.sandbox.commands.run(killer, { timeoutMs: 10_000 }).catch(() => {});
    }
  }

  private async waitForDevServer(state: E2bAppState): Promise<boolean> {
    const deadline = Date.now() + DEV_BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const check = await safeRun(
          state.sandbox,
          `curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:${state.port} || true`,
          { timeoutMs: 10_000 },
        );
        const code = check.stdout.trim();
        if (/^[23]\d\d$/.test(code)) {
          return true;
        }
      } catch {
        /* sandbox busy — retry */
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton + reconciliation
// ---------------------------------------------------------------------------

export const e2bSandboxProvider = new E2bCloudSandboxProvider();

/**
 * Called at server boot: hard-kill sandboxes whose apps no longer exist in
 * the DB. Sandboxes for live apps are left paused and resume lazily.
 */
export async function reconcileE2bSandboxes(): Promise<void> {
  if (!isE2bRuntimeMode()) return;
  const registry = readRegistry();
  const appIds = Object.keys(registry).map(Number);
  if (appIds.length === 0) return;

  const { db } = await import("@/db");
  const { apps } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    const liveApps = await db
      .select({ id: apps.id })
      .from(apps)
      .where(inArray(apps.id, appIds));
    const liveIds = new Set(liveApps.map((a) => a.id));
    for (const appId of appIds) {
      if (!liveIds.has(appId)) {
        await e2bSandboxProvider.killSandboxForApp(appId);
      }
    }
  } catch (error) {
    logger.warn("E2B sandbox reconciliation failed:", error);
  }
}
