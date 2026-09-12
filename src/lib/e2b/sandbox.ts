// E2B sandbox manager — the runtime core of Forge.
// Sandboxes are created/resumed/paused per app, run the project's dev server,
// and expose files + commands to the agent. All keys come from user settings.

import { Sandbox, type CommandHandle } from "e2b";
import { db } from "@/lib/db";
import { getTemplate, IGNORED_PATH_PREFIXES } from "./templates";
import { startMcpBridges, stopMcpBridges, type McpBridge } from "@/lib/mcp/manager";

export interface LogLine {
  ts: number;
  stream: "stdout" | "stderr";
  line: string;
}

export interface RunningSandbox {
  appId: string;
  userId: string;
  sandbox: Sandbox;
  devHandle: CommandHandle | null;
  devReady: boolean;
  logs: LogLine[];
  mcp: Map<string, McpBridge>;
  lastActive: number;
}

export const APP_ROOT = "/home/user/app";

const globalStore = globalThis as unknown as {
  __forgeSandboxes?: Map<string, RunningSandbox>;
  __forgeSweeper?: ReturnType<typeof setInterval>;
};

const sandboxes: Map<string, RunningSandbox> =
  globalStore.__forgeSandboxes ?? new Map();
globalStore.__forgeSandboxes = sandboxes;

const MAX_LOGS = 600;
const PAUSE_AFTER_INACTIVE_MS = 4 * 60_000; // user left the builder
const SANDBOX_TTL_MS = 30 * 60_000; // hard E2B timeout w/ autoPause

export class SandboxError extends Error {
  code: string;
  constructor(message: string, code = "sandbox_error") {
    super(message);
    this.code = code;
  }
}

export async function getE2BApiKey(userId: string): Promise<string | null> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  return settings?.e2bApiKey ?? null;
}

function pushLog(entry: RunningSandbox, stream: "stdout" | "stderr", data: string) {
  for (const line of data.split("\n")) {
    if (line.trim().length === 0) continue;
    entry.logs.push({ ts: Date.now(), stream, line });
  }
  if (entry.logs.length > MAX_LOGS) entry.logs.splice(0, entry.logs.length - MAX_LOGS);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function ensureSandbox(appId: string, userId: string): Promise<RunningSandbox> {
  cancelPendingPause(appId);
  const existing = sandboxes.get(appId);
  if (existing) {
    existing.lastActive = Date.now();
    // Health check: the registry can claim "running" while E2B has actually
    // expired the sandbox. Verify before trusting the cached entry.
    const healthy = await Promise.race([
      existing.sandbox.isRunning().catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), 12_000)),
    ]);
    if (!healthy) {
      console.warn(`[e2b] cached sandbox ${appId} is dead — dropping entry`);
      await stopMcpBridges(existing).catch(() => {});
      sandboxes.delete(appId);
    } else {
      // If a previous boot crashed mid-scaffold, recover: restart dev + bridges.
      if (!existing.devReady) {
        const template = getTemplate((await db.app.findUnique({ where: { id: appId } }))?.templateId ?? "react-vite");
        await entryResume(existing, template, (await db.app.findUnique({ where: { id: appId } }))?.previewPort ?? template.port);
      }
      return existing;
    }
  }

  const app = await db.app.findFirst({ where: { id: appId, userId } });
  if (!app) throw new SandboxError("App not found", "not_found");

  const apiKey = await getE2BApiKey(userId);
  if (!apiKey) throw new SandboxError("No E2B API key configured. Add it in Settings → E2B.", "no_e2b_key");

  await db.app.update({
    where: { id: appId },
    data: { sandboxStatus: "starting" },
  });

  const template = getTemplate(app.templateId);

  // 1) Try to resume a paused sandbox (fastest, keeps memory)
  if (app.sandboxId) {
    try {
      const sandbox = await Sandbox.connect(app.sandboxId, {
        apiKey,
        timeoutMs: SANDBOX_TTL_MS,
      });
      const entry = await registerSandbox(sandbox, appId, userId);
      await db.app.update({
        where: { id: appId },
        data: { sandboxStatus: "running", sandboxId: sandbox.sandboxId },
      });
      await entryResume(entry, template, app.previewPort);
      return entry;
    } catch (err) {
      console.warn(`[e2b] resume failed for ${appId}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2) Fall back to the last snapshot
  if (app.snapshotId) {
    try {
      const sandbox = await Sandbox.create(app.snapshotId, {
        apiKey,
        timeoutMs: SANDBOX_TTL_MS,
      });
      const entry = await registerSandbox(sandbox, appId, userId);
      await db.app.update({
        where: { id: appId },
        data: { sandboxStatus: "running", sandboxId: sandbox.sandboxId },
      });
      await entryResume(entry, template, app.previewPort);
      return entry;
    } catch (err) {
      console.warn(`[e2b] snapshot restore failed for ${appId}:`, err instanceof Error ? err.message : err);
    }
  }

  // 3) Fresh sandbox from template
  const sandbox = await Sandbox.create("base", {
    apiKey,
    timeoutMs: SANDBOX_TTL_MS,
  });
  const entry = await registerSandbox(sandbox, appId, userId);

  await writeTemplateFiles(sandbox, template.id);
  pushLog(entry, "stdout", `> ${template.installCmd}`);
  await withReconnect(entry, userId, (sbx) =>
    sbx.commands.run(template.installCmd, {
      cwd: APP_ROOT,
      timeoutMs: 10 * 60_000,
      onStdout: (d) => pushLog(entry, "stdout", d.toString()),
      onStderr: (d) => pushLog(entry, "stderr", d.toString()),
    })
  );
  await startDevServer(entry, template.port);
  await snapshotSandbox(appId); // baseline snapshot
  await db.app.update({
    where: { id: appId },
    data: { sandboxStatus: "running", sandboxId: sandbox.sandboxId, previewPort: template.port },
  });
  return entry;
}

async function registerSandbox(
  sandbox: Sandbox,
  appId: string,
  userId: string
): Promise<RunningSandbox> {
  const entry: RunningSandbox = {
    appId,
    userId,
    sandbox,
    devHandle: null,
    devReady: false,
    logs: [],
    mcp: new Map(),
    lastActive: Date.now(),
  };
  sandboxes.set(appId, entry);
  startSweeper();
  return entry;
}

async function entryResume(entry: RunningSandbox, template: { devCmd: string; port: number; id: string }, previewPort: number) {
  // dev servers die on pause — always restart after resume
  await startDevServer(entry, previewPort || template.port);
  await installAppSkills(entry);
  await startMcpBridges(entry);
}

export async function writeTemplateFiles(sandbox: Sandbox, templateId: string) {
  const template = getTemplate(templateId);
  await sandbox.commands.run(`rm -rf ${APP_ROOT} && mkdir -p ${APP_ROOT}`);
  for (const [path, content] of Object.entries(template.files)) {
    const full = `${APP_ROOT}/${path}`;
    await sandbox.files.write(full, content);
  }
}

export async function startDevServer(entry: RunningSandbox, port: number) {
  const app = await db.app.findUnique({ where: { id: entry.appId } });
  const template = getTemplate(app?.templateId ?? "react-vite");
  // Kill any previous dev server (detached processes survive SDK streams)
  await withReconnect(entry, entry.userId, (sbx) =>
    sbx.commands.run(
      `pkill -f 'vite' ; pkill -f 'next dev' ; pkill -f 'expo' ; pkill -f 'http-server' ; pkill -f 'node server.js' ; true`,
      { timeoutMs: 10_000 }
    )
  ).catch(() => {});
  // Wait for the port to actually be released (pkill is asynchronous —
  // racing a new dev server onto the port causes EADDRINUSE).
  await withReconnect(entry, entry.userId, (sbx) =>
    sbx.commands.run(
      `for i in $(seq 1 12); do (echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null || exit 0; sleep 1; done; true`,
      { timeoutMs: 20_000 }
    )
  ).catch(() => {});
  if (entry.devHandle) {
    try { await entry.devHandle.kill(); } catch {}
    entry.devHandle = null;
  }
  pushLog(entry, "stdout", `> ${template.devCmd}`);
  // Fully detach the dev server from the envd session so it survives
  // SDK reconnects, module reloads and long idle periods.
  await withReconnect(entry, entry.userId, (sbx) =>
    sbx.commands.run(
      `cd ${APP_ROOT} && rm -f /tmp/forge-dev.log && setsid nohup ${template.devCmd} > /tmp/forge-dev.log 2>&1 < /dev/null & echo "dev-server-started"`,
      { cwd: APP_ROOT, timeoutMs: 20_000 }
    )
  );
  entry.devReady = true;
}

export async function restartApp(appId: string, userId: string) {
  const entry = await ensureSandbox(appId, userId);
  const app = await db.app.findUnique({ where: { id: appId } });
  await startDevServer(entry, app?.previewPort ?? 5173);
}

export async function reinstallAndRestartApp(appId: string, userId: string) {
  const entry = await ensureSandbox(appId, userId);
  const app = await db.app.findUnique({ where: { id: appId } });
  const template = getTemplate(app?.templateId ?? "react-vite");
  pushLog(entry, "stdout", `> rm -rf node_modules && ${template.installCmd}`);
  await withReconnect(entry, userId, (sbx) =>
    sbx.commands.run(`rm -rf node_modules && ${template.installCmd}`, {
      cwd: APP_ROOT,
      timeoutMs: 10 * 60_000,
      onStdout: (d) => pushLog(entry, "stdout", d.toString()),
      onStderr: (d) => pushLog(entry, "stderr", d.toString()),
    })
  );
  await startDevServer(entry, app?.previewPort ?? 5173);
}

// Debounced pause: a navigation race can fire "leave builder → pause" right
// before the next page's "start" for the same app. The 10s window lets a
// new start cancel the pending pause.
const pendingPauses: Map<string, ReturnType<typeof setTimeout>> =
  (globalThis as unknown as { __forgePendingPauses?: Map<string, ReturnType<typeof setTimeout>> })
    .__forgePendingPauses ?? new Map();
(globalThis as unknown as { __forgePendingPauses?: Map<string, ReturnType<typeof setTimeout>> }).__forgePendingPauses = pendingPauses;

const PAUSE_DEBOUNCE_MS = 10_000;

export function cancelPendingPause(appId: string) {
  const t = pendingPauses.get(appId);
  if (t) {
    clearTimeout(t);
    pendingPauses.delete(appId);
  }
}

export function pauseSandbox(appId: string, userId: string): Promise<void> {
  cancelPendingPause(appId);
  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      pendingPauses.delete(appId);
      await performPause(appId, userId).catch((e) => console.warn("[e2b] pause error:", e));
      resolve();
    }, PAUSE_DEBOUNCE_MS);
    pendingPauses.set(appId, timer);
  });
}

async function performPause(appId: string, userId: string): Promise<void> {
  const entry = sandboxes.get(appId);
  const app = await db.app.findFirst({ where: { id: appId, userId } });
  if (!app) return;

  if (!entry) {
    await db.app.update({ where: { id: appId }, data: { sandboxStatus: "paused" } });
    return;
  }
  // Active again? A start beat the debounce — skip pausing.
  if (Date.now() - entry.lastActive < PAUSE_DEBOUNCE_MS / 2) {
    await db.app.update({ where: { id: appId }, data: { sandboxStatus: "running" } });
    return;
  }
  try {
    await snapshotSandbox(appId);
  } catch (err) {
    console.warn("[e2b] snapshot before pause failed:", err);
  }
  await stopMcpBridges(entry);
  try { if (entry.devHandle) await entry.devHandle.kill(); } catch {}
  try {
    await entry.sandbox.pause();
    await db.app.update({
      where: { id: appId },
      data: { sandboxStatus: "paused", sandboxId: entry.sandbox.sandboxId },
    });
  } catch (err) {
    console.warn("[e2b] pause failed:", err);
    try { await entry.sandbox.kill(); } catch {}
    await db.app.update({ where: { id: appId }, data: { sandboxStatus: "paused" } });
  }
  sandboxes.delete(appId);
}

export async function snapshotSandbox(appId: string): Promise<string | null> {
  const entry = sandboxes.get(appId);
  if (!entry) return null;
  try {
    const snap = await entry.sandbox.createSnapshot();
    await db.app.update({
      where: { id: appId },
      data: { snapshotId: snap.snapshotId },
    });
    return snap.snapshotId;
  } catch (err) {
    console.warn("[e2b] snapshot failed:", err);
    return null;
  }
}

export function getSandboxEntry(appId: string): RunningSandbox | undefined {
  const entry = sandboxes.get(appId);
  if (entry) entry.lastActive = Date.now();
  return entry;
}

export async function killSandbox(appId: string) {
  const entry = sandboxes.get(appId);
  if (entry) {
    await stopMcpBridges(entry);
    try { if (entry.devHandle) await entry.devHandle.kill(); } catch {}
    try { await entry.sandbox.kill(); } catch {}
    sandboxes.delete(appId);
  }
}

export async function getSandboxStatus(appId: string, userId: string) {
  const entry = sandboxes.get(appId);
  const app = await db.app.findFirst({ where: { id: appId, userId } });
  return {
    status: entry ? "running" : app?.sandboxStatus ?? "none",
    sandboxId: entry?.sandbox.sandboxId ?? app?.sandboxId ?? null,
    previewUrl: entry ? `https://${entry.sandbox.getHost(app?.previewPort ?? 5173)}` : null,
    lastActiveAt: app?.lastActiveAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Files + commands
// ---------------------------------------------------------------------------

export function isIgnored(path: string): boolean {
  const p = path.replace(/^\/+/, "");
  return IGNORED_PATH_PREFIXES.some((prefix) => p === prefix.slice(0, -1) || p.startsWith(prefix));
}

export async function listFilesRecursive(appId: string, userId: string, path = APP_ROOT): Promise<FileNode[]> {
  const entry = await ensureSandbox(appId, userId);
  return listDir(entry, path, 0);
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileNode[];
}

async function listDir(entry: RunningSandbox, dirPath: string, depth: number): Promise<FileNode[]> {
  const out: FileNode[] = [];
  if (depth > 6) return out;
  let entries;
  try {
    entries = await withReconnect(entry, entry.userId, (sbx) => sbx.files.list(dirPath));
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = e.path.replace(/^\/home\/user\/app\/?/, "");
    if (isIgnored(rel) || e.name === ".skills") continue;
    if (e.type === "dir") {
      out.push({
        name: e.name,
        path: rel,
        type: "dir",
        children: await listDir(entry, e.path, depth + 1),
      });
    } else {
      out.push({ name: e.name, path: rel, type: "file", size: e.size });
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Connection resilience — the in-memory SDK client can go stale (module
// reloads, idle websockets). On connection-type errors we reconnect to the
// same sandboxId and retry once.
// ---------------------------------------------------------------------------

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("deadline") ||
    msg.includes("disconnected") ||
    msg.includes("connection") ||
    msg.includes("network") ||
    msg.includes("closed") ||
    msg.includes("process exited without a result")
  );
}

async function reconnectEntry(entry: RunningSandbox, userId: string): Promise<void> {
  const apiKey = await getE2BApiKey(userId);
  if (!apiKey) throw new SandboxError("No E2B API key configured", "no_e2b_key");
  const fresh = await Sandbox.connect(entry.sandbox.sandboxId, {
    apiKey,
    timeoutMs: SANDBOX_TTL_MS,
  });
  entry.sandbox = fresh;
  entry.lastActive = Date.now();
}

async function withReconnect<T>(
  entry: RunningSandbox,
  userId: string,
  fn: (sandbox: Sandbox) => Promise<T>
): Promise<T> {
  try {
    return await fn(entry.sandbox);
  } catch (err) {
    console.warn(
      `[e2b] withReconnect caught:`,
      err instanceof Error ? `${err.constructor.name}: ${err.message.slice(0, 120)}` : String(err),
      `| isConn=${isConnectionError(err)}`
    );
    if (!isConnectionError(err)) throw err;
    console.warn(`[e2b] stale connection for ${entry.appId}, reconnecting…`);
    await reconnectEntry(entry, userId);
    return await fn(entry.sandbox);
  }
}

export async function readSandboxFile(appId: string, userId: string, relPath: string): Promise<string> {
  const entry = await ensureSandbox(appId, userId);
  const full = `${APP_ROOT}/${relPath.replace(/^\/+/, "")}`;
  const content = await withReconnect(entry, userId, (sbx) => sbx.files.read(full));
  return String(content);
}

export async function writeSandboxFile(appId: string, userId: string, relPath: string, content: string): Promise<void> {
  const entry = await ensureSandbox(appId, userId);
  const rel = relPath.replace(/^\/+/, "");
  if (isIgnored(rel)) throw new SandboxError("Path is ignored", "ignored_path");
  await withReconnect(entry, userId, (sbx) => sbx.files.write(`${APP_ROOT}/${rel}`, content));
}

export async function runSandboxCommand(
  appId: string,
  userId: string,
  command: string,
  timeoutMs = 120_000,
  cwd = APP_ROOT
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const entry = await ensureSandbox(appId, userId);
  const result = await withReconnect(entry, userId, (sbx) =>
    sbx.commands.run(command, {
      cwd,
      timeoutMs,
      onStdout: (d) => pushLog(entry, "stdout", d.toString()),
      onStderr: (d) => pushLog(entry, "stderr", d.toString()),
    })
  );
  return { exitCode: result.exitCode ?? 0, stdout: result.stdout, stderr: result.stderr };
}

export function getLogs(appId: string): LogLine[] {
  return sandboxes.get(appId)?.logs ?? [];
}

// Command activity log + the dev server's own log file (detached process).
export async function getDevLogs(appId: string): Promise<LogLine[]> {
  const entry = sandboxes.get(appId);
  if (!entry) return [];
  const activity = entry.logs.slice(-80);
  let dev: LogLine[] = [];
  try {
    const res = await withReconnect(entry, entry.userId, (sbx) =>
      sbx.commands.run("tail -n 200 /tmp/forge-dev.log 2>/dev/null || true", {
        timeoutMs: 6000,
      })
    );
    dev = res.stdout.split("\n").filter((l) => l.trim().length > 0).map((line) => ({
      ts: Date.now(),
      stream: "stdout" as const,
      line,
    }));
  } catch {}
  return [...activity, ...dev];
}

export function getPreviewUrl(appId: string): string | null {
  return null; // computed via getSandboxStatus (needs db port lookup)
}

// ---------------------------------------------------------------------------
// Skills — write installed skills into the sandbox filesystem
// ---------------------------------------------------------------------------

export async function installAppSkills(entry: RunningSandbox) {
  const appSkills = await db.appSkill.findMany({
    where: { appId: entry.appId, enabled: true, skill: { enabled: true } },
    include: { skill: true },
  });
  await entry.sandbox.commands.run(`mkdir -p ${APP_ROOT}/.skills`).catch(() => {});
  for (const { skill } of appSkills) {
    try {
      const files: { path: string; content: string }[] = JSON.parse(skill.filesJson || "[]");
      await withReconnect(entry, entry.userId, (sbx) => sbx.commands.run(`rm -rf ${APP_ROOT}/.skills/${skill.slug}`));
      for (const f of files) {
        const safe = f.path.replace(/\/+$/, "");
        await withReconnect(entry, entry.userId, (sbx) => sbx.files.write(`${APP_ROOT}/.skills/${skill.slug}/${safe}`, f.content));
      }
    } catch (err) {
      console.warn(`[skills] failed to install ${skill.slug}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Sweeper — pause sandboxes abandoned by users who closed the tab
// ---------------------------------------------------------------------------

function startSweeper() {
  if (globalStore.__forgeSweeper) return;
  globalStore.__forgeSweeper = setInterval(async () => {
    const now = Date.now();
    for (const [appId, entry] of sandboxes) {
      if (now - entry.lastActive > PAUSE_AFTER_INACTIVE_MS) {
        console.log(`[e2b] sweeper: pausing inactive sandbox ${appId}`);
        pauseSandbox(appId, entry.userId).catch(() => {});
      } else {
        // keep the E2B TTL rolling while the user is active
        withReconnect(entry, entry.userId, (sbx) => sbx.setTimeout(SANDBOX_TTL_MS)).catch(() => {});
      }
    }
  }, 60_000);
  if (typeof globalStore.__forgeSweeper === "object" && "unref" in (globalStore.__forgeSweeper as object)) {
    (globalStore.__forgeSweeper as unknown as { unref: () => void }).unref();
  }
}

export async function touchApp(appId: string) {
  await db.app.update({
    where: { id: appId },
    data: { lastActiveAt: new Date(), updatedAt: new Date() },
  }).catch(() => {});
}
