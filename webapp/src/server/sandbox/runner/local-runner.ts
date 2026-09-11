import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { appDataDir } from "../../db";
import {
  AppRunner,
  EnsureResult,
  ExecResult,
  SANDBOX_DEV_PORT,
} from "./types";

/**
 * Local runner (self-hosted / development fallback).
 *
 * Runs the app as a plain child process on the host machine instead of an E2B
 * sandbox. Used when no E2B key is configured (or DYAD_RUNNER=local) so the
 * whole product remains usable offline; the preview is proxied through the
 * Next.js server at /api/preview/{appId}/.
 *
 * This mirrors Dyad's original local execution model, minus Electron.
 */

interface LocalRuntime {
  dir: string;
  port: number;
  proc?: ChildProcess;
  running: boolean;
  logs: string[];
}

const PORT_BASE = 9100;

export class LocalRunner implements AppRunner {
  readonly kind = "local" as const;
  private runtimes = new Map<number, LocalRuntime>();

  private dirFor(slug: string): string {
    return path.join(appDataDir(), slug);
  }

  private portFor(appId: number): number {
    return PORT_BASE + appId;
  }

  private rt(appId: number, slug: string): LocalRuntime {
    let rt = this.runtimes.get(appId);
    if (!rt) {
      rt = {
        dir: this.dirFor(slug),
        port: this.portFor(appId),
        running: false,
        logs: [],
      };
      this.runtimes.set(appId, rt);
    }
    return rt;
  }

  private log(rt: LocalRuntime, onLog: (l: string) => void, line: string) {
    rt.logs.push(`${new Date().toISOString()} ${line}`);
    if (rt.logs.length > 500) rt.logs.shift();
    onLog(line);
  }

  private waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tryOnce = () => {
        const socket = net.connect({ port, host: "127.0.0.1" });
        socket.setTimeout(800);
        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });
        const retry = () => {
          socket.destroy();
          if (Date.now() > deadline) resolve(false);
          else setTimeout(tryOnce, 500);
        };
        socket.on("error", retry);
        socket.on("timeout", retry);
      };
      tryOnce();
    });
  }

  async ensure(opts: {
    appId: number;
    slug: string;
    sandboxId: string | null;
    start: boolean;
    onLog: (line: string) => void;
  }): Promise<EnsureResult> {
    const rt = this.rt(opts.appId, opts.slug);
    fs.mkdirSync(rt.dir, { recursive: true });
    if (opts.start) {
      await this.restart({ appId: opts.appId, slug: opts.slug, onLog: opts.onLog });
    }
    return {
      sandboxId: `local-${opts.slug}`,
      previewUrl: opts.start
        ? `/api/preview/${opts.appId}/`
        : rt.running
          ? `/api/preview/${opts.appId}/`
          : null,
      fresh: true,
    };
  }

  async syncFiles(opts: {
    appId: number;
    slug: string;
    files: { path: string; content: string }[];
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = this.rt(opts.appId, opts.slug);
    fs.mkdirSync(rt.dir, { recursive: true });
    for (const f of opts.files) {
      const target = path.join(rt.dir, f.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.content);
      this.log(rt, opts.onLog, `[sync] wrote ${f.path}`);
    }
  }

  async install(opts: {
    appId: number;
    slug: string;
    packages?: string[];
    onLog: (line: string) => void;
  }): Promise<ExecResult> {
    const rt = this.rt(opts.appId, opts.slug);
    const pkgs = opts.packages?.length ? ` ${opts.packages.join(" ")}` : "";
    this.log(rt, opts.onLog, `[install] npm install${pkgs}`);
    try {
      const stdout = execSync(
        // Same flags as upstream Dyad (app_runtime_service.ts):
      // --legacy-peer-deps. --include=dev guards against the web server's
      // NODE_ENV=production leaking into generated apps (vite is a devDep).
      `npm install${pkgs} --legacy-peer-deps --include=dev --no-audit --no-fund --prefer-offline --loglevel=error`,
        {
          cwd: rt.dir,
          encoding: "utf8",
          timeout: 900_000,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, NODE_ENV: "development" },
        },
      );
      this.log(rt, opts.onLog, "[install] done");
      return { exitCode: 0, stdout: stdout.slice(-4000), stderr: "" };
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message: string };
      this.log(rt, opts.onLog, `[install] FAILED: ${e.message.slice(0, 300)}`);
      return { exitCode: 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message };
    }
  }

  private killDev(rt: LocalRuntime) {
    if (rt.proc) {
      try {
        process.kill(-rt.proc.pid!, "SIGTERM");
      } catch {
        /* already dead */
      }
      rt.proc = undefined;
    }
    try {
      execSync(`fuser -k ${rt.port}/tcp 2>/dev/null || true`);
    } catch {
      /* port already free */
    }
    rt.running = false;
  }

  async restart(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = this.rt(opts.appId, opts.slug);
    this.killDev(rt);
    this.log(rt, opts.onLog, `[dev] starting vite on :${rt.port}`);
    rt.proc = spawn(
      "npm",
      ["run", "dev", "--", "--host", "0.0.0.0", "--port", String(rt.port), "--strictPort"],
      {
        cwd: rt.dir,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "development",
          DYAD_PREVIEW_BASE: `/api/preview/${opts.appId}/`,
        },
      },
    );
    rt.proc.stdout?.on("data", (d) =>
      String(d)
        .split("\n")
        .filter(Boolean)
        .forEach((l) => this.log(rt, opts.onLog, `[dev] ${l}`)),
    );
    rt.proc.stderr?.on("data", (d) =>
      String(d)
        .split("\n")
        .filter(Boolean)
        .forEach((l) => this.log(rt, opts.onLog, `[dev] ${l}`)),
    );
    rt.proc.on("exit", (code) => {
      rt.running = false;
      this.log(rt, opts.onLog, `[dev] exited (${code})`);
    });
    const up = await this.waitForPort(rt.port, 120_000);
    if (!up) {
      throw new Error("Dev server did not come up within 120s (check the Logs tab)");
    }
    rt.running = true;
    this.log(rt, opts.onLog, "[dev] dev server is up");
  }

  async rebuild(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<ExecResult> {
    const rt = this.rt(opts.appId, opts.slug);
    this.killDev(rt);
    this.log(rt, opts.onLog, "[rebuild] removing node_modules…");
    fs.rmSync(path.join(rt.dir, "node_modules"), { recursive: true, force: true });
    const res = await this.install({ appId: opts.appId, slug: opts.slug, onLog: opts.onLog });
    await this.restart({ appId: opts.appId, slug: opts.slug, onLog: opts.onLog });
    return res;
  }

  async stop(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = this.rt(opts.appId, opts.slug);
    this.killDev(rt);
    this.log(rt, opts.onLog, "[stop] dev server stopped");
  }

  async dispose(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = this.rt(opts.appId, opts.slug);
    this.killDev(rt);
    this.runtimes.delete(opts.appId);
    opts.onLog("[dispose] local runtime disposed");
  }

  async exec(opts: {
    appId: number;
    slug: string;
    command: string;
    onLog: (line: string) => void;
  }): Promise<ExecResult> {
    const rt = this.rt(opts.appId, opts.slug);
    this.log(rt, opts.onLog, `[exec] ${opts.command}`);
    try {
      const stdout = execSync(opts.command, {
        cwd: rt.dir,
        encoding: "utf8",
        timeout: 120_000,
      });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message: string };
      return { exitCode: 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message };
    }
  }

  getLogs(appId: number): string[] {
    return this.runtimes.get(appId)?.logs ?? [];
  }

  async getPreviewUrl(appId: number): Promise<string | null> {
    const rt = this.runtimes.get(appId);
    if (!rt?.running) return null;
    return `/api/preview/${appId}/`;
  }
}
