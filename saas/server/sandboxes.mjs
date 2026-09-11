// Sandbox drivers: E2B (primary, cloud) + local emulation fallback.
// Every app gets exactly one sandbox; all code + commands run inside it.
// Skill files are synced into <app>/.skills so the agent can read them in-sandbox.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getSettings } from "./store.mjs";
import { SCAFFOLD_FILES } from "./scaffold.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ROOT = path.join(__dirname, "local-sandboxes");
export const APP_DIR = "/home/user/app"; // cwd inside E2B sandbox
export const PREVIEW_PORT = 5173;

function emit(onEvent, e) {
  try {
    onEvent && onEvent(e);
  } catch {}
}

// ---------------------------------------------------------------- E2B driver
let E2BModule = null;
async function e2b() {
  if (!E2BModule) E2BModule = await import("@e2b/code-interpreter");
  return E2BModule;
}

const e2bHandles = new Map(); // sandboxId -> Sandbox

async function e2bConnect(sandboxId, apiKey) {
  if (e2bHandles.has(sandboxId)) return e2bHandles.get(sandboxId);
  const { Sandbox } = await e2b();
  const sbx = await Sandbox.connect(sandboxId, { apiKey });
  e2bHandles.set(sandboxId, sbx);
  return sbx;
}

const ENSURE_NODE = `node --version 2>/dev/null || (echo "Installing Node.js..." && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs)`;

export const E2BDriver = {
  name: "e2b",
  async validateKey(apiKey) {
    const { Sandbox } = await e2b();
    const sbx = await Sandbox.create({
      apiKey,
      timeoutMs: 60_000,
      metadata: { purpose: "dyad-saas-validation" },
    });
    const id = sbx.sandboxId;
    try {
      await sbx.kill();
    } catch {}
    return { ok: true, sandboxId: id };
  },
  async create({ apiKey, template, timeoutMs, metadata }, onEvent) {
    const { Sandbox } = await e2b();
    emit(onEvent, { type: "log", stream: "system", text: "Creating E2B sandbox…" });
    // "base" template may not exist on all accounts; fall back to default template.
    let sbx;
    const tryTemplates = template && template !== "base" ? [template, undefined] : [undefined];
    let lastErr = null;
    for (const t of tryTemplates) {
      try {
        sbx = t
          ? await Sandbox.create(t, { apiKey, timeoutMs, metadata })
          : await Sandbox.create({ apiKey, timeoutMs, metadata });
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!sbx) throw lastErr || new Error("E2B sandbox creation failed");
    e2bHandles.set(sbx.sandboxId, sbx);
    emit(onEvent, { type: "log", stream: "system", text: `Sandbox ${sbx.sandboxId} ready.` });
    return { sandboxId: sbx.sandboxId };
  },
  async exec(sandboxId, command, opts = {}) {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    const res = await sbx.commands.run(command, {
      cwd: opts.cwd || APP_DIR,
      timeoutMs: opts.timeoutMs || 120_000,
      envs: opts.envs,
    });
    return { exitCode: res.exitCode, stdout: res.stdout || "", stderr: res.stderr || "", error: res.error };
  },
  async execBackground(sandboxId, command, opts = {}) {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    const handle = await sbx.commands.run(command, {
      cwd: opts.cwd || APP_DIR,
      timeoutMs: 0,
      background: true,
    });
    return { pid: handle.pid };
  },
  async writeFiles(sandboxId, files) {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    const entries = Object.entries(files).map(([p, content]) => ({
      path: p.startsWith("/") ? p : `${APP_DIR}/${p.replace(/^\.\//, "")}`,
      data: content,
    }));
    // chunk to stay under request limits
    for (let i = 0; i < entries.length; i += 20) {
      await sbx.files.write(entries.slice(i, i + 20));
    }
  },
  async writeFile(sandboxId, relPath, content) {
    return this.writeFiles(sandboxId, { [relPath]: content });
  },
  async readFile(sandboxId, relPath) {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    const full = relPath.startsWith("/") ? relPath : `${APP_DIR}/${relPath.replace(/^\.\//, "")}`;
    return sbx.files.read(full, { format: "text" });
  },
  async list(sandboxId, relPath = ".") {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    const full = relPath === "." || relPath === "" ? APP_DIR : `${APP_DIR}/${relPath.replace(/^\.\//, "")}`;
    const entries = await sbx.files.list(full);
    return entries.map((e) => ({ name: e.name, type: String(e.type).toLowerCase().includes("dir") ? "dir" : "file", path: e.path }));
  },
  async remove(sandboxId, relPath) {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    const full = `${APP_DIR}/${relPath.replace(/^\.\//, "")}`;
    await sbx.files.remove(full);
  },
  async rename(sandboxId, from, to) {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    await sbx.files.rename(`${APP_DIR}/${from.replace(/^\.\//, "")}`, `${APP_DIR}/${to.replace(/^\.\//, "")}`);
  },
  async tree(sandboxId, relPath = ".", depth = 3) {
    // recursive listing via a single command for speed
    const res = await this.exec(
      sandboxId,
      `find ${relPath === "." ? "." : JSON.stringify(relPath)} -maxdepth ${depth} -not -path "*/node_modules*" -not -path "*/.git*" | sort | head -n 300`,
      { cwd: APP_DIR },
    );
    return (res.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  },
  async previewUrl(sandboxId, port = PREVIEW_PORT) {
    const s = getSettings();
    const sbx = await e2bConnect(sandboxId, s.e2bKey);
    const host = sbx.getHost(port);
    return `https://${host}`;
  },
  async keepalive(sandboxId, timeoutMs) {
    try {
      const s = getSettings();
      const sbx = await e2bConnect(sandboxId, s.e2bKey);
      if (typeof sbx.setTimeout === "function") await sbx.setTimeout(timeoutMs);
    } catch {}
  },
  async kill(sandboxId) {
    try {
      const s = getSettings();
      const sbx = await e2bConnect(sandboxId, s.e2bKey);
      await sbx.kill();
    } catch {}
    e2bHandles.delete(sandboxId);
  },
  async provision(sandboxId, extraFiles, onEvent) {
    emit(onEvent, { type: "log", stream: "system", text: "Ensuring Node.js runtime…" });
    await this.exec(sandboxId, ENSURE_NODE, { timeoutMs: 300_000, cwd: "/tmp" });
    emit(onEvent, { type: "log", stream: "system", text: "Writing project scaffold…" });
    await this.writeFiles(sandboxId, { ...SCAFFOLD_FILES, ...(extraFiles || {}) });
    emit(onEvent, { type: "log", stream: "system", text: "Installing dependencies (npm install)…" });
    const res = await this.exec(sandboxId, "npm install --no-audit --no-fund", { timeoutMs: 600_000 });
    emit(onEvent, { type: "log", stream: "stdout", text: res.stdout.slice(-2000) });
    if (res.exitCode !== 0) {
      emit(onEvent, { type: "log", stream: "stderr", text: (res.stderr || "").slice(-2000) });
      throw new Error(`npm install failed (exit ${res.exitCode})`);
    }
    await this.startDev(sandboxId, onEvent);
  },
  async startDev(sandboxId, onEvent) {
    emit(onEvent, { type: "log", stream: "system", text: "Starting dev server…" });
    await this.exec(sandboxId, `pkill -f "vite.*5173" 2>/dev/null; echo ok`);
    await this.execBackground(sandboxId, `nohup npm run dev > /tmp/vite.log 2>&1 & echo started`);
    // wait for port
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const probe = await this.exec(sandboxId, `curl -s -o /dev/null -w "%{http_code}" http://localhost:${PREVIEW_PORT}/ || echo 000`);
      if ((probe.stdout || "").includes("200")) break;
    }
    emit(onEvent, { type: "log", stream: "system", text: "Dev server started." });
  },
  async rebuild(sandboxId, onEvent) {
    await this.exec(sandboxId, "rm -rf node_modules package-lock.json");
    const res = await this.exec(sandboxId, "npm install --no-audit --no-fund", { timeoutMs: 600_000 });
    if (res.exitCode !== 0) throw new Error("npm install failed during rebuild");
    await this.startDev(sandboxId, onEvent);
  },
};

// ------------------------------------------------------- local fallback driver
function localDir(appId) {
  return path.join(LOCAL_ROOT, appId, "app");
}
function localResolve(appId, relPath) {
  const root = localDir(appId);
  const full = path.resolve(root, relPath === "." || !relPath ? "." : relPath);
  if (!full.startsWith(root)) throw new Error("Path escapes sandbox");
  return full;
}
async function localExec(cmd, cwd, timeoutMs = 120_000) {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", cmd], { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { exitCode: 0, stdout: stdout || "", stderr: stderr || "" };
  } catch (err) {
    return { exitCode: err.code ?? 1, stdout: err.stdout || "", stderr: err.stderr || String(err.message || err) };
  }
}

export const LocalDriver = {
  name: "local",
  async create({ appId }, onEvent) {
    emit(onEvent, { type: "log", stream: "system", text: "Creating local emulation sandbox…" });
    fs.mkdirSync(localDir(appId), { recursive: true });
    return { sandboxId: `local_${appId}` };
  },
  async exec(appSandboxId, command, opts = {}) {
    const appId = appSandboxId.replace(/^local_/, "");
    return localExec(command, localDir(appId), opts.timeoutMs);
  },
  async execBackground(appSandboxId, command) {
    const appId = appSandboxId.replace(/^local_/, "");
    localExec(`nohup bash -lc ${JSON.stringify(command)} > /tmp/dyad-local-${appId}.log 2>&1 & echo started`, localDir(appId), 15_000);
    return { pid: 0 };
  },
  async writeFiles(appSandboxId, files) {
    const appId = appSandboxId.replace(/^local_/, "");
    for (const [rel, content] of Object.entries(files)) {
      const full = localResolve(appId, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
  },
  async writeFile(appSandboxId, relPath, content) {
    return this.writeFiles(appSandboxId, { [relPath]: content });
  },
  async readFile(appSandboxId, relPath) {
    const appId = appSandboxId.replace(/^local_/, "");
    return fs.readFileSync(localResolve(appId, relPath), "utf8");
  },
  async list(appSandboxId, relPath = ".") {
    const appId = appSandboxId.replace(/^local_/, "");
    const full = localResolve(appId, relPath);
    return fs.readdirSync(full, { withFileTypes: true }).map((d) => ({
      name: d.name,
      type: d.isDirectory() ? "dir" : "file",
      path: path.posix.join(relPath === "." ? "" : relPath, d.name),
    }));
  },
  async remove(appSandboxId, relPath) {
    const appId = appSandboxId.replace(/^local_/, "");
    fs.rmSync(localResolve(appId, relPath), { recursive: true, force: true });
  },
  async rename(appSandboxId, from, to) {
    const appId = appSandboxId.replace(/^local_/, "");
    const dest = localResolve(appId, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(localResolve(appId, from), dest);
  },
  async tree(appSandboxId) {
    const appId = appSandboxId.replace(/^local_/, "");
    const root = localDir(appId);
    const out = [];
    const walk = (dir, prefix, depth) => {
      if (depth > 3) return;
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.name === "node_modules" || d.name === ".git" || d.name === "dist") continue;
        out.push(`${prefix}${d.name}`);
        if (d.isDirectory()) walk(path.join(dir, d.name), `${prefix}${d.name}/`, depth + 1);
        if (out.length > 300) return;
      }
    };
    if (fs.existsSync(root)) walk(root, "", 0);
    return out;
  },
  async previewUrl() {
    return null; // served by our own express static (see index.mjs /preview/:appId)
  },
  async keepalive() {},
  async kill(appSandboxId) {
    const appId = appSandboxId.replace(/^local_/, "");
    await localExec(`pkill -f "dyad-local-${appId}" 2>/dev/null; echo ok`, "/tmp", 10_000).catch(() => {});
  },
  async provision(appSandboxId, extraFiles, onEvent) {
    const appId = appSandboxId.replace(/^local_/, "");
    emit(onEvent, { type: "log", stream: "system", text: "Writing project scaffold (local emulation)…" });
    await this.writeFiles(appSandboxId, { ...SCAFFOLD_FILES, ...(extraFiles || {}) });
    emit(onEvent, { type: "log", stream: "system", text: "Installing dependencies (npm install)…" });
    const res = await this.exec(appSandboxId, "npm install --no-audit --no-fund", { timeoutMs: 600_000 });
    if (res.exitCode !== 0) {
      emit(onEvent, { type: "log", stream: "stderr", text: (res.stderr || res.stdout || "").slice(-3000) });
      throw new Error(`npm install failed (exit ${res.exitCode})`);
    }
    emit(onEvent, { type: "log", stream: "stdout", text: (res.stdout || "").slice(-1000) });
    await this.buildStatic(appSandboxId, onEvent);
  },
  async startDev(appSandboxId, onEvent) {
    // local emulation serves the production build statically (iframe-safe)
    await this.buildStatic(appSandboxId, onEvent);
  },
  async buildStatic(appSandboxId, onEvent) {
    emit(onEvent, { type: "log", stream: "system", text: "Building app for preview…" });
    const res = await this.exec(appSandboxId, "npm run build", { timeoutMs: 600_000 });
    emit(onEvent, { type: "log", stream: res.exitCode === 0 ? "stdout" : "stderr", text: ((res.stdout || "") + (res.stderr || "")).slice(-2000) });
    if (res.exitCode !== 0) throw new Error("Build failed");
  },
  async rebuild(appSandboxId, onEvent) {
    await this.exec(appSandboxId, "rm -rf node_modules package-lock.json dist");
    await this.provision(appSandboxId, {}, onEvent);
  },
  distDir(appId) {
    return path.join(localDir(appId), "dist");
  },
};

export function driverFor(app) {
  return app.sandboxDriver === "local" ? LocalDriver : E2BDriver;
}
