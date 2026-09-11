// ============================================================================
// App runtime manager — owns the lifecycle of each app's sandbox.
//
// Responsibilities:
//  - create / reconnect / stop sandboxes (E2B primary, local fallback)
//  - provision the scaffold, skills, MCP servers and the MCP bridge
//  - file operations that keep a durable local mirror of app files
//  - dev server management (start / restart / rebuild) + preview URLs
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStore, save, uid, dataDir } from "../db.js";
import { E2BRuntime } from "./e2b.js";
import { LocalRuntime } from "./local.js";
import { MCP_BRIDGE_SOURCE } from "../mcp/bridge-source.js";
import type { App, SandboxRuntime, Settings } from "../types.js";

const APP_DIR_IN_SANDBOX = "/home/user/app";
const SKILLS_DIR_IN_SANDBOX = "/home/user/skills";
const MCP_BRIDGE_PORT = 3777;

export interface AppSession {
  app: App;
  runtime: SandboxRuntime;
  logLines: RingLog;
  devServerPid?: number;
  devServerReady: boolean;
  lastKeepAlive: number;
  mcp?: { token: string; baseUrl: string | null; localPort?: number };
}

function assetsDir() {
  return path.resolve(import.meta.dirname, "../../assets");
}

function mirrorDir(appId: string) {
  return path.join(dataDir(), "apps", appId, "files");
}

export class RingLog {
  lines: string[] = [];
  push(line: string) {
    for (const l of line.split("\n")) {
      if (l.trim()) {
        this.lines.push(l);
        if (this.lines.length > 800) this.lines.shift();
      }
    }
  }
  tail(n = 200): string {
    return this.lines.slice(-n).join("\n");
  }
}

export class RuntimeManager {
  private sessions = new Map<string, AppSession>();
  private keepAliveTimer?: NodeJS.Timeout;

  constructor() {
    this.keepAliveTimer = setInterval(() => this.refreshKeepAlives(), 4 * 60_000);
    this.keepAliveTimer.unref();
  }

  getSession(appId: string): AppSession | undefined {
    return this.sessions.get(appId);
  }

  logs(appId: string): string {
    return this.sessions.get(appId)?.logLines.tail() ?? "";
  }

  private pushLog(appId: string, line: string) {
    this.sessions.get(appId)?.logLines.push(line.trim());
  }

  // ---- Settings resolution -------------------------------------------------

  private resolveE2BKey(settings: Settings): string {
    return settings.e2bApiKey || process.env.E2B_API_KEY || "";
  }

  // ---- Provisioning ----------------------------------------------------------

  async createSandbox(app: App, settings: Settings): Promise<AppSession> {
    this.cleanupSession(app.id);
    const log = new RingLog();
    const onLog = (line: string) => this.pushLog(app.id, line);

    const wantE2B = settings.runtimeMode === "e2b" && !!this.resolveE2BKey(settings);
    let runtime: SandboxRuntime;
    try {
      if (wantE2B) {
        this.pushLog(app.id, "[provision] creating E2B sandbox...");
        runtime = await E2BRuntime.create({
          apiKey: this.resolveE2BKey(settings),
          ...(settings.e2bDomain ? { domain: settings.e2bDomain } : {}),
          timeoutMs: Math.min(settings.e2bTimeoutMinutes, 60) * 60_000,
          metadata: { dyadAppId: app.id },
          onLog,
        });
        this.pushLog(app.id, `[provision] sandbox ${runtime.sandboxId} created`);
      } else {
        this.pushLog(app.id, "[provision] creating local runtime workspace...");
        runtime = await LocalRuntime.create({
          workspaceDir: path.join(dataDir(), "apps", app.id, "workspace"),
          onLog,
        });
      }
    } catch (e: any) {
      app.sandbox.status = "error";
      app.sandbox.lastError = `Failed to create sandbox: ${e.message}`;
      const store = getStore();
      save("apps");
      throw e;
    }

    const session: AppSession = {
      app,
      runtime,
      logLines: log,
      devServerReady: false,
      lastKeepAlive: Date.now(),
    };
    this.sessions.set(app.id, session);

    try {
      await this.provision(app, settings, runtime);
      await this.installSkills(app, runtime);
      await this.setupMcp(app, settings, runtime);
      await this.installDependencies(app, runtime);
      await this.startDevServer(app, settings, runtime);
      app.sandbox.status = "running";
      app.sandbox.lastError = undefined;
      app.sandbox.startedAt = new Date().toISOString();
      if (runtime.mode === "e2b") app.sandbox.sandboxId = runtime.sandboxId ?? undefined;
      if (runtime.mode === "local") app.sandbox.localDir = (runtime as LocalRuntime).workspace;
      save("apps");
    } catch (e: any) {
      app.sandbox.status = "error";
      app.sandbox.lastError = e.message;
      save("apps");
      throw e;
    }

    const previewUrl = await runtime.getPreviewUrl(8080);
    if (runtime.mode === "local") {
      app.sandbox.port = (runtime as LocalRuntime).port;
      app.sandbox.previewUrl = `/preview/${app.id}/`;
    } else {
      app.sandbox.previewUrl = previewUrl;
    }
    save("apps");
    return session;
  }

  /** Upload scaffold + write cloud-enabling config files. */
  private async provision(app: App, settings: Settings, runtime: SandboxRuntime) {
    this.pushLog(app.id, "[provision] uploading scaffold...");
    const tarball = fs.readFileSync(path.join(assetsDir(), "scaffold.tgz"));
    const b64 = tarball.toString("base64");
    // chunk the base64 to stay well under write limits
    const chunkSize = 1_000_000;
    const parts: string[] = [];
    for (let i = 0; i < b64.length; i += chunkSize) parts.push(b64.slice(i, i + chunkSize));
    for (let i = 0; i < parts.length; i++) {
      await runtime.writeFile(`${APP_DIR_IN_SANDBOX}/.dyad-scaffold.part${i}`, parts[i]);
    }
    const extract = await runtime.run(
      `cd ${APP_DIR_IN_SANDBOX} && cat .dyad-scaffold.part* | base64 -d | tar -xz && rm .dyad-scaffold.part*`,
      { cwd: APP_DIR_IN_SANDBOX, timeoutMs: 120_000 },
    );
    if (extract.exitCode !== 0) throw new Error(`scaffold extraction failed: ${extract.stderr.slice(0, 500)}`);

    // git identity for turn commits
    await runtime.run(`cd ${APP_DIR_IN_SANDBOX} && git init -q 2>/dev/null; git config user.email "agent@dyad.cloud"; git config user.name "Dyad Cloud Agent"; git add -A; git commit -qm "initial scaffold" 2>/dev/null; true`);
    this.pushLog(app.id, "[provision] scaffold ready");
  }

  /** Write installed skills into the sandbox and expose them to the agent. */
  async installSkills(app: App, runtime?: SandboxRuntime) {
    const rt = runtime ?? this.sessions.get(app.id)?.runtime;
    if (!rt) return;
    const store = getStore();
    const skills = store.skills.filter((s) => app.config.installedSkillIds.includes(s.id));
    await rt.run(`mkdir -p ${SKILLS_DIR_IN_SANDBOX}`);
    for (const skill of skills) {
      const dir = `${SKILLS_DIR_IN_SANDBOX}/${skill.slug}`;
      await rt.writeFile(`${dir}/SKILL.md`, skill.instructions);
      await rt.writeFile(
        `${dir}/skill.json`,
        JSON.stringify({ id: skill.id, name: skill.name, slug: skill.slug, description: skill.description }, null, 2),
      );
    }
    this.pushLog(app.id, `[skills] ${skills.length} skill(s) installed into sandbox`);
  }

  /** Write the MCP bridge + config for the app's enabled MCP servers. */
  async setupMcp(app: App, settings: Settings, runtime?: SandboxRuntime) {
    const rt = runtime ?? this.sessions.get(app.id)?.runtime;
    if (!rt) return;
    const store = getStore();
    const servers = store.mcps.filter((m) => app.config.installedMcpServerIds.includes(m.id));

    const token = uid("mcp_");
    const localBridgePort = rt.mode === "local" ? (rt as LocalRuntime).port + 1 : MCP_BRIDGE_PORT;
    const cfg = {
      token,
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        transport: s.transport,
        ...(s.transport === "stdio"
          ? { command: s.command, args: s.args, env: s.env }
          : { url: s.url, headers: s.headers }),
      })),
    };
    await rt.run("mkdir -p /home/user/.dyad");
    await rt.writeFile("/home/user/.dyad/mcp-bridge.mjs", MCP_BRIDGE_SOURCE);
    await rt.writeFile("/home/user/.dyad/mcp-config.json", JSON.stringify(cfg, null, 2));
    // kill any previously started bridge
    await rt.run("pkill -f mcp-bridge.mjs 2>/dev/null; true", { timeoutMs: 10_000 });

    const startCmd =
      rt.mode === "local"
        ? `BRIDGE_BASE_DIR="${(rt as LocalRuntime).workspace}/.dyad" BRIDGE_PORT=${localBridgePort} node "${(rt as LocalRuntime).workspace}/.dyad/mcp-bridge.mjs"`
        : `node /home/user/.dyad/mcp-bridge.mjs`;
    const start = await rt.startBackground(startCmd, {
      ...(rt.mode === "local"
        ? { env: { BRIDGE_BASE_DIR: `${(rt as LocalRuntime).workspace}/.dyad`, BRIDGE_PORT: String(localBridgePort) } }
        : {}),
    });
    this.pushLog(app.id, `[mcp] bridge started (pid ${start.pid}) for ${servers.length} server(s)`);
    // wait for bridge health
    const host = rt.mode === "local" ? `http://127.0.0.1:${localBridgePort}` : await rt.getPreviewUrl(MCP_BRIDGE_PORT);
    const deadline = Date.now() + 30_000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${host}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    const session = this.sessions.get(app.id);
    if (session) {
      session.mcp = {
        token,
        baseUrl: rt.mode === "local" ? null : host,
        localPort: rt.mode === "local" ? localBridgePort : undefined,
      };
    }
    if (servers.length > 0 && !healthy) {
      this.pushLog(app.id, "[mcp] warning: bridge health check timed out");
    }
  }

  async callMcp(appId: string, serverId: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; text?: string; error?: string }> {
    const session = this.sessions.get(appId);
    const info = session?.mcp;
    if (!session || !info) return { ok: false, error: "MCP bridge not running for this app" };
    const base = info.baseUrl ?? `http://127.0.0.1:${info.localPort}`;
    try {
      const res = await fetch(`${base}/call`, {
        method: "POST",
        headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
        body: JSON.stringify({ server: serverId, tool, args }),
        signal: AbortSignal.timeout(150_000),
      });
      const data: any = await res.json();
      if (!res.ok) return { ok: false, error: data.error || `bridge returned ${res.status}` };
      return { ok: !data.isError, text: data.text ?? JSON.stringify(data.result) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  async listMcpTools(appId: string): Promise<{ server: string; serverName: string; name: string; description: string; inputSchema: unknown }[]> {
    const session = this.sessions.get(appId);
    const info = session?.mcp;
    if (!session || !info) return [];
    const base = info.baseUrl ?? `http://127.0.0.1:${info.localPort}`;
    try {
      const res = await fetch(`${base}/tools`, {
        headers: { authorization: `Bearer ${info.token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const data: any = await res.json();
      return data.tools ?? [];
    } catch {
      return [];
    }
  }

  private async installDependencies(app: App, runtime: SandboxRuntime) {
    this.pushLog(app.id, "[provision] installing dependencies (npm install)... this can take a few minutes");
    const res = await runtime.run(`cd ${APP_DIR_IN_SANDBOX} && npm install --include=dev --no-audit --no-fund 2>&1 | tail -5`, {
      timeoutMs: 15 * 60_000,
    });
    if (res.exitCode !== 0) {
      throw new Error(`npm install failed: ${(res.stdout + res.stderr).slice(0, 800)}`);
    }
    this.pushLog(app.id, "[provision] dependencies installed");
  }

  async startDevServer(app: App, settings: Settings, runtime?: SandboxRuntime) {
    const rt = runtime ?? this.sessions.get(app.id)?.runtime;
    if (!rt) throw new Error("sandbox not running");
    const session = this.sessions.get(app.id)!;
    // kill existing dev server
    if (session.devServerPid) {
      await rt.killProc(session.devServerPid).catch(() => {});
      session.devServerPid = undefined;
    }
    const cmd =
      rt.mode === "local"
        ? `cd ${APP_DIR_IN_SANDBOX} && npx vite --base /preview/${app.id}/ --port ${(rt as LocalRuntime).port} --strictPort`
        : `cd ${APP_DIR_IN_SANDBOX} && npm run dev`;
    if (rt.mode === "local") {
      // Kill anything still bound to the port (e.g. an orphaned vite from a
      // previous server process).
      const port = (rt as LocalRuntime).port;
      await rt.run(
        `kill -9 $(ss -ltnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\\K[0-9]+' | sort -u) 2>/dev/null; true`,
        { timeoutMs: 15_000 },
      );
    }
    this.pushLog(app.id, `[dev] starting dev server (port ${rt.mode === "local" ? (rt as LocalRuntime).port : 8080}) ...`);
    const proc = await rt.startBackground(cmd);
    session.devServerPid = proc.pid;
    session.devServerReady = await this.waitForHttp(app, rt, rt.mode === "local" ? (rt as LocalRuntime).port : 8080, 90_000);
    if (session.devServerReady) {
      this.pushLog(app.id, "[dev] dev server is up");
    } else {
      this.pushLog(app.id, "[dev] warning: dev server did not respond in time — check the Logs tab");
    }
  }

  private async waitForHttp(app: App, rt: SandboxRuntime, port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const target =
          rt.mode === "local"
            ? `http://127.0.0.1:${port}/preview/${app.id}/`
            : await rt.getPreviewUrl(port);
        const res = await fetch(target, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return true;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, Math.min(1500 * attempt, 5000)));
    }
    return false;
  }

  // ---- App-facing operations -------------------------------------------------

  async ensureRunning(app: App, settings: Settings): Promise<AppSession> {
    const existing = this.sessions.get(app.id);
    if (existing && app.sandbox.status === "running") {
      await existing.runtime.keepAlive().catch(() => {});
      // Make sure the dev server is actually serving; restart if not.
      if (!existing.devServerReady) {
        existing.devServerReady = await this.waitForHttp(app, existing.runtime, existing.runtime.mode === "local" ? (existing.runtime as LocalRuntime).port : 8080, 15_000);
        if (!existing.devServerReady) {
          this.pushLog(app.id, "[dev] dev server not responding — restarting...");
          await this.startDevServer(app, settings, existing.runtime);
        }
      }
      return existing;
    }
    if (existing) this.cleanupSession(app.id);

    // Resume a local workspace that already exists (server restart case).
    if (settings.runtimeMode === "local" && app.sandbox.localDir && fs.existsSync(path.join(app.sandbox.localDir, "app", "package.json"))) {
      this.pushLog(app.id, "[provision] resuming local workspace...");
      const runtime = await LocalRuntime.create({ workspaceDir: app.sandbox.localDir });
      const session: AppSession = { app, runtime, logLines: new RingLog(), devServerReady: false, lastKeepAlive: Date.now() };
      this.sessions.set(app.id, session);
      await this.installSkills(app, runtime);
      await this.setupMcp(app, settings, runtime);
      await this.startDevServer(app, settings, runtime);
      app.sandbox.status = "running";
      app.sandbox.port = runtime.port;
      app.sandbox.previewUrl = `/preview/${app.id}/`;
      save("apps");
      return session;
    }

    // Try to reconnect to a live E2B sandbox.
    if (settings.runtimeMode === "e2b" && this.resolveE2BKey(settings) && app.sandbox.sandboxId) {
      try {
        this.pushLog(app.id, `[provision] reconnecting to sandbox ${app.sandbox.sandboxId}...`);
        const runtime = await E2BRuntime.connect({
          sandboxId: app.sandbox.sandboxId,
          apiKey: this.resolveE2BKey(settings),
          ...(settings.e2bDomain ? { domain: settings.e2bDomain } : {}),
        });
        const log = new RingLog();
        const session: AppSession = {
          app,
          runtime,
          logLines: log,
          devServerReady: false,
          lastKeepAlive: Date.now(),
        };
        this.sessions.set(app.id, session);
        await this.setupMcp(app, settings, runtime);
        await this.installSkills(app, runtime);
        await this.startDevServer(app, settings, runtime);
        app.sandbox.status = "running";
        app.sandbox.previewUrl = await runtime.getPreviewUrl(8080);
        save("apps");
        return session;
      } catch (e: any) {
        this.pushLog(app.id, `[provision] reconnect failed (${e.message}); recreating sandbox from mirrored files...`);
        this.cleanupSession(app.id);
      }
    }
    return this.createSandbox(app, settings);
  }

  /** Recreate sandbox from the durable mirror (E2B sandboxes are ephemeral). */
  async recreateFromMirror(app: App, settings: Settings): Promise<AppSession> {
    const mirror = mirrorDir(app.id);
    const session = await this.createSandbox(app, settings);
    if (fs.existsSync(mirror)) {
      this.pushLog(app.id, "[restore] restoring mirrored files into sandbox...");
      const count = await this.restoreMirror(session.runtime, mirror);
      this.pushLog(app.id, `[restore] ${count} files restored`);
      await session.runtime.run(`cd ${APP_DIR_IN_SANDBOX} && git add -A && git commit -qm "restore from snapshot" 2>/dev/null; true`);
      await this.startDevServer(app, settings, session.runtime);
    }
    return session;
  }

  private async restoreMirror(runtime: SandboxRuntime, mirror: string): Promise<number> {
    let count = 0;
    const walk = async (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const child = path.join(dir, entry.name);
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(child, childRel);
        } else {
          await runtime.writeFile(`${APP_DIR_IN_SANDBOX}/${childRel}`, fs.readFileSync(child, "utf8"));
          count++;
        }
      }
    };
    await walk(mirror, "");
    return count;
  }

  // ---- Mirrored file operations (used by agent tools) -------------------------

  async writeFile(appId: string, relPath: string, content: string): Promise<void> {
    const session = this.sessions.get(appId);
    if (session) {
      await session.runtime.writeFile(`${APP_DIR_IN_SANDBOX}/${relPath}`, content);
    }
    const target = path.join(mirrorDir(appId), relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    const store = getStore();
    const appRow = store.apps.find((a) => a.id === appId);
    if (appRow) appRow.fileCount = countFiles(mirrorDir(appId));
    save("apps");
  }

  async readFile(appId: string, relPath: string): Promise<string> {
    const session = this.sessions.get(appId);
    if (session) {
      try {
        return await session.runtime.readFile(`${APP_DIR_IN_SANDBOX}/${relPath}`);
      } catch {
        /* fall through to mirror */
      }
    }
    return fs.readFileSync(path.join(mirrorDir(appId), relPath), "utf8");
  }

  async deleteFile(appId: string, relPath: string): Promise<void> {
    const session = this.sessions.get(appId);
    if (session) await session.runtime.removeFile(`${APP_DIR_IN_SANDBOX}/${relPath}`).catch(() => {});
    fs.rmSync(path.join(mirrorDir(appId), relPath), { recursive: true, force: true });
  }

  async renameFile(appId: string, from: string, to: string): Promise<void> {
    const session = this.sessions.get(appId);
    if (session) await session.runtime.renameFile(`${APP_DIR_IN_SANDBOX}/${from}`, `${APP_DIR_IN_SANDBOX}/${to}`);
    const src = path.join(mirrorDir(appId), from);
    const dst = path.join(mirrorDir(appId), to);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
    }
  }

  readMirrorFile(appId: string, relPath: string): string | null {
    try {
      return fs.readFileSync(path.join(mirrorDir(appId), relPath), "utf8");
    } catch {
      return null;
    }
  }

  listMirrorFiles(appId: string): { path: string; isDirectory: boolean }[] {
    const root = mirrorDir(appId);
    if (!fs.existsSync(root)) return [];
    const out: { path: string; isDirectory: boolean }[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          out.push({ path: childRel, isDirectory: true });
          walk(path.join(dir, entry.name), childRel);
        } else {
          out.push({ path: childRel, isDirectory: false });
        }
      }
    };
    walk(root, "");
    return out;
  }

  async runInApp(appId: string, cmd: string, timeoutMs?: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const session = this.sessions.get(appId);
    if (!session) throw new Error("sandbox not running");
    return session.runtime.run(cmd, { cwd: APP_DIR_IN_SANDBOX, timeoutMs: timeoutMs ?? 120_000 });
  }

  appDir(): string {
    return APP_DIR_IN_SANDBOX;
  }

  // ---- Cleanup -----------------------------------------------------------------

  cleanupSession(appId: string) {
    const session = this.sessions.get(appId);
    if (!session) return;
    session.runtime.stop().catch(() => {});
    this.sessions.delete(appId);
  }

  async stopApp(app: App): Promise<void> {
    this.cleanupSession(app.id);
    app.sandbox.status = "stopped";
    save("apps");
  }

  private async refreshKeepAlives() {
    for (const [appId, session] of this.sessions) {
      if (Date.now() - session.lastKeepAlive < 10 * 60_000) continue;
      session.lastKeepAlive = Date.now();
      session.runtime.keepAlive().catch(() => {
        this.pushLog(appId, "[keepalive] failed — sandbox may have expired");
      });
    }
  }
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else count++;
    }
  };
  walk(dir);
  return count;
}

export const runtimeManager = new RuntimeManager();
