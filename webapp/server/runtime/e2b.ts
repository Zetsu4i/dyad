// ============================================================================
// E2B cloud sandbox runtime (primary execution environment).
// Wraps the official `e2b` SDK behind the SandboxRuntime interface.
// ============================================================================
import { Sandbox } from "e2b";
import type { ProcInfo, RunResult, SandboxRuntime } from "../types.js";

const LOG_BUFFER_LIMIT = 500;

export class E2BRuntime implements SandboxRuntime {
  readonly mode = "e2b" as const;
  readonly sandboxId: string;
  private sandbox: Sandbox;
  private apiKey: string;
  private domain?: string;
  private logBuffer: string[] = [];
  private onLog?: (line: string) => void;

  constructor(sandbox: Sandbox, apiKey: string, domain?: string, onLog?: (line: string) => void) {
    this.sandbox = sandbox;
    this.sandboxId = sandbox.sandboxId;
    this.apiKey = apiKey;
    this.domain = domain;
    this.onLog = onLog;
  }

  static async create(opts: {
    apiKey: string;
    domain?: string;
    timeoutMs: number;
    metadata?: Record<string, string>;
    onLog?: (line: string) => void;
  }): Promise<E2BRuntime> {
    const sandbox = await Sandbox.create({
      apiKey: opts.apiKey,
      ...(opts.domain ? { domain: opts.domain } : {}),
      timeoutMs: opts.timeoutMs,
      metadata: opts.metadata,
    });
    return new E2BRuntime(sandbox, opts.apiKey, opts.domain, opts.onLog);
  }

  static async connect(opts: {
    sandboxId: string;
    apiKey: string;
    domain?: string;
    onLog?: (line: string) => void;
  }): Promise<E2BRuntime> {
    const sandbox = await Sandbox.connect(opts.sandboxId, {
      apiKey: opts.apiKey,
      ...(opts.domain ? { domain: opts.domain } : {}),
    });
    return new E2BRuntime(sandbox, opts.apiKey, opts.domain, opts.onLog);
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
    const res = await this.sandbox.commands.run(cmd, {
      cwd: opts?.cwd,
      timeoutMs: opts?.timeoutMs ?? 120_000,
      ...(opts?.env ? { envs: opts.env } : {}),
    });
    if (res.stdout.trim()) this.log(`$ ${cmd}\n${res.stdout.trim().slice(0, 4000)}`);
    if (res.exitCode !== 0 && res.stderr.trim()) this.log(`[stderr] ${res.stderr.trim().slice(0, 4000)}`);
    return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
  }

  async startBackground(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): Promise<ProcInfo> {
    const handle = await this.sandbox.commands.run(cmd, {
      cwd: opts?.cwd,
      background: true,
      ...(opts?.env ? { envs: opts.env } : {}),
      onStdout: (data) => data.split("\n").forEach((l) => l.trim() && this.log(l)),
      onStderr: (data) => data.split("\n").forEach((l) => l.trim() && this.log(`[err] ${l}`)),
    });
    return { pid: handle.pid, command: cmd };
  }

  async listProcs(): Promise<ProcInfo[]> {
    const procs = await this.sandbox.commands.list();
    return procs.map((p) => ({ pid: p.pid, command: p.cmd }));
  }

  async killProc(pid: number): Promise<void> {
    await this.sandbox.commands.kill(pid);
  }

  async readFile(path: string): Promise<string> {
    return this.sandbox.files.read(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.files.write(path, content);
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await this.sandbox.files.exists(path);
    } catch {
      return false;
    }
  }

  async listDir(path: string): Promise<{ path: string; isDirectory: boolean }[]> {
    const entries = await this.sandbox.files.list(path);
    return entries.map((e) => ({ path: e.path, isDirectory: (e as any).isDirectory ?? (e as any).type === 2 }));
  }

  async removeFile(path: string): Promise<void> {
    await this.sandbox.files.remove(path);
  }

  async renameFile(from: string, to: string): Promise<void> {
    await this.sandbox.files.rename(from, to);
  }

  async getPreviewUrl(port: number): Promise<string> {
    return `https://${this.sandbox.getHost(port)}`;
  }

  async keepAlive(): Promise<void> {
    await Sandbox.setTimeout(this.sandboxId, 15 * 60_000, {
      apiKey: this.apiKey,
      ...(this.domain ? { domain: this.domain } : {}),
    });
  }

  async stop(): Promise<void> {
    try {
      await this.sandbox.kill();
    } catch {
      // already gone
    }
  }
}
