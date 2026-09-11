// ============================================================================
// Local process runtime — development fallback that mirrors the E2B sandbox
// interface using child processes in a workspace directory. Used when E2B is
// unreachable (offline development) or explicitly selected in settings.
// ============================================================================
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import type { ProcInfo, RunResult, SandboxRuntime } from "../types.js";

const LOG_BUFFER_LIMIT = 500;

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    let port = start;
    const tryPort = () => {
      const srv = net.createServer();
      srv.once("error", () => {
        port += 1;
        if (port > start + 50) resolve(start);
        else tryPort();
      });
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, "0.0.0.0");
    };
    tryPort();
  });
}

export class LocalRuntime implements SandboxRuntime {
  readonly mode = "local" as const;
  readonly sandboxId: string | null = null;
  readonly workspaceDir: string;
  port: number;
  private procs = new Map<number, ChildProcess>();
  private logBuffer: string[] = [];
  private onLog?: (line: string) => void;
  private nextPid = 1;

  private constructor(workspaceDir: string, port: number, onLog?: (line: string) => void) {
    this.workspaceDir = workspaceDir;
    this.port = port;
    this.onLog = onLog;
  }

  static async create(opts: { workspaceDir: string; onLog?: (line: string) => void }): Promise<LocalRuntime> {
    fs.mkdirSync(opts.workspaceDir, { recursive: true });
    const port = await findFreePort(8100);
    return new LocalRuntime(opts.workspaceDir, port, opts.onLog);
  }

  get workspace(): string {
    return this.workspaceDir;
  }

  private log(line: string) {
    this.logBuffer.push(line);
    if (this.logBuffer.length > LOG_BUFFER_LIMIT) this.logBuffer.shift();
    this.onLog?.(line);
  }

  getLogs(): string[] {
    return this.logBuffer;
  }

  async run(cmd: string, opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<RunResult> {
    const timeoutMs = opts?.timeoutMs ?? 120_000;
    return new Promise((resolve) => {
      this.log(`$ ${cmd}`);
      const { NODE_ENV: _drop, ...restEnv } = process.env;
      const child = spawn("bash", ["-c", this.mapCmd(cmd)], {
        cwd: opts?.cwd ? this.mapPath(opts.cwd) : this.workspaceDir,
        env: { ...restEnv, NODE_ENV: "development", ...(opts?.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout?.on("data", (d) => {
        stdout += d.toString();
        if (stdout.length > 400_000) stdout = stdout.slice(-200_000);
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString();
        if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (stdout.trim()) this.log(stdout.trim().slice(0, 2000));
        if (code && stderr.trim()) this.log(`[stderr] ${stderr.trim().slice(0, 2000)}`);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${e.message}` });
      });
    });
  }

  async startBackground(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): Promise<ProcInfo> {
    const pid = this.nextPid++;
    this.log(`[bg] ${cmd}`);
    const child = spawn("bash", ["-c", this.mapCmd(cmd)], {
      cwd: opts?.cwd ? this.mapPath(opts.cwd) : this.workspaceDir,
      env: { ...process.env, ...(opts?.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    child.stdout?.on("data", (d) => d.toString().split("\n").forEach((l: string) => l.trim() && this.log(l)));
    child.stderr?.on("data", (d) => d.toString().split("\n").forEach((l: string) => l.trim() && this.log(`[err] ${l}`)));
    child.on("close", (code) => this.log(`[bg exit ${code}] ${cmd}`));
    child.on("error", (e) => this.log(`[bg error] ${e.message}`));
    this.procs.set(pid, child);
    return { pid, command: cmd };
  }

  async listProcs(): Promise<ProcInfo[]> {
    return [...this.procs.entries()]
      .filter(([, child]) => child.exitCode === null)
      .map(([pid, child]) => ({ pid, command: `bash -c ${(child.spawnargs[1] ?? "").slice(0, 120)}` }));
  }

  async killProc(pid: number): Promise<void> {
    const child = this.procs.get(pid);
    if (child) {
      // Kill the whole tree (bash + children like vite).
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      this.procs.delete(pid);
    }
  }

  async readFile(p: string): Promise<string> {
    return fs.readFileSync(this.mapPath(p), "utf8");
  }

  async writeFile(p: string, content: string): Promise<void> {
    const full = this.mapPath(p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  async exists(p: string): Promise<boolean> {
    return fs.existsSync(this.mapPath(p));
  }

  async listDir(p: string): Promise<{ path: string; isDirectory: boolean }[]> {
    const full = this.mapPath(p);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).map((e) => {
      const childPath = path.posix.join(p === "/" ? "" : p, e.name);
      return { path: childPath, isDirectory: e.isDirectory() };
    });
  }

  async removeFile(p: string): Promise<void> {
    fs.rmSync(this.mapPath(p), { recursive: true, force: true });
  }

  async renameFile(from: string, to: string): Promise<void> {
    const src = this.mapPath(from);
    const dst = this.mapPath(to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  }

  async getPreviewUrl(port: number): Promise<string> {
    // Local "sandbox" services run on this machine.
    return `http://127.0.0.1:${port}`;
  }

  async keepAlive(): Promise<void> {
    // no-op — local processes stay alive
  }

  async stop(): Promise<void> {
    for (const [, child] of this.procs) {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* gone */ }
      }
    }
    this.procs.clear();
  }

  private safeJoin(p: string): string {
    const resolved = path.resolve(this.workspaceDir, p.replace(/^\/+/, ""));
    if (!resolved.startsWith(path.resolve(this.workspaceDir))) {
      throw new Error(`Path escapes workspace: ${p}`);
    }
    return resolved;
  }

  /**
   * Rewrite sandbox-style absolute paths embedded in shell commands so they
   * work identically on the local workspace. Paths that already point into
   * the real workspace are left untouched.
   */
  private mapCmd(cmd: string): string {
    if (this.workspaceDir === "/home/user") return cmd;
    let out = "";
    let i = 0;
    const needle = "/home/user/";
    while (i < cmd.length) {
      const idx = cmd.indexOf(needle, i);
      if (idx === -1) {
        out += cmd.slice(i);
        break;
      }
      if (cmd.startsWith(this.workspaceDir, idx)) {
        // Already a real path into the workspace — keep as-is.
        out += cmd.slice(i, idx + needle.length);
        i = idx + needle.length;
        continue;
      }
      out += cmd.slice(i, idx) + `${this.workspaceDir}/`;
      i = idx + needle.length;
    }
    return out;
  }

  /**
   * Map sandbox-style absolute paths onto the workspace. The sandbox layout
   * treats /home/user as the home directory; locally that is the workspace.
   */
  private mapPath(p: string): string {
    if (p === "/home/user") return this.workspaceDir;
    if (p.startsWith("/home/user/")) return path.join(this.workspaceDir, p.slice("/home/user/".length));
    if (p.startsWith("/")) return this.safeJoin(p);
    return this.safeJoin(p);
  }
}
