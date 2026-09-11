import { Sandbox } from "e2b";
import {
  AppRunner,
  EnsureResult,
  ExecResult,
  SANDBOX_APP_DIR,
  SANDBOX_DEV_PORT,
  SANDBOX_SKILLS_DIR,
} from "./types";

/**
 * E2B cloud runner (production path).
 *
 * Every app gets its own E2B sandbox. The sandbox:
 *  - hosts the app source at /home/user/app
 *  - runs `npm install` + `npm run dev` inside
 *  - exposes the dev server publicly at https://{sandbox.getHost(port)}
 *
 * The E2B API key is supplied by the user through Settings → Sandbox and is
 * resolved at call time (never baked into the deployment).
 */

interface AppRuntime {
  sandbox: Sandbox;
  devServer?: { kill: () => Promise<void> };
  logs: string[];
}

const DEV_COMMAND = `cd ${SANDBOX_APP_DIR} && (npm install --legacy-peer-deps --include=dev --no-audit --no-fund --prefer-offline 2>&1 | tail -2; nohup npm run dev -- --host 0.0.0.0 --port ${SANDBOX_DEV_PORT} --strictPort > /tmp/dev-server.log 2>&1 &) && for i in $(seq 1 120); do curl -s -o /dev/null http://localhost:${SANDBOX_DEV_PORT} && break; sleep 2; done; curl -s -o /dev/null -w "%{http_code}" http://localhost:${SANDBOX_DEV_PORT}`;

export class E2BRunner implements AppRunner {
  readonly kind = "e2b" as const;
  private runtimes = new Map<number, AppRuntime>();
  private apiKeyProvider: () => string;
  private templateProvider: () => string | undefined;
  private keepAlive: NodeJS.Timeout;

  constructor(opts: {
    apiKey: () => string;
    template?: () => string | undefined;
  }) {
    this.apiKeyProvider = opts.apiKey;
    this.templateProvider = opts.template ?? (() => undefined);
    // Keep live sandboxes warm; E2B reaps sandboxes whose timeout lapses.
    this.keepAlive = setInterval(() => {
      for (const [appId, rt] of this.runtimes) {
        rt.sandbox
          .setTimeout(10 * 60_000)
          .catch(() => this.runtimes.delete(appId));
      }
    }, 4 * 60_000);
  }

  disposeAll() {
    clearInterval(this.keepAlive);
  }

  private apiKey(): string {
    const key = this.apiKeyProvider();
    if (!key) {
      throw new Error(
        "No E2B API key configured. Add your key in Settings → Sandbox (E2B).",
      );
    }
    return key;
  }

  private runtime(appId: number): AppRuntime | undefined {
    return this.runtimes.get(appId);
  }

  private log(rt: AppRuntime, onLog: (l: string) => void, line: string) {
    rt.logs.push(line);
    if (rt.logs.length > 500) rt.logs.shift();
    onLog(line);
  }

  private async connectOrCreate(opts: {
    appId: number;
    sandboxId: string | null;
    rt?: AppRuntime;
    onLog: (l: string) => void;
  }): Promise<AppRuntime> {
    if (opts.rt) return opts.rt;
    const apiKey = this.apiKey();
    let sandbox: Sandbox | null = null;
    if (opts.sandboxId) {
      try {
        sandbox = await Sandbox.connect(opts.sandboxId, { apiKey });
      } catch {
        sandbox = null;
      }
    }
    if (!sandbox) {
      const template = this.templateProvider();
      sandbox = await Sandbox.create(
        template ? { template, apiKey } : { apiKey },
      );
    }
    const rt: AppRuntime = { sandbox, logs: [] };
    this.runtimes.set(opts.appId, rt);
    return rt;
  }

  async ensure(opts: {
    appId: number;
    slug: string;
    sandboxId: string | null;
    start: boolean;
    onLog: (line: string) => void;
  }): Promise<EnsureResult> {
    const existing = this.runtime(opts.appId);
    const rt = await this.connectOrCreate({
      appId: opts.appId,
      sandboxId: opts.sandboxId,
      rt: existing,
      onLog: opts.onLog,
    });
    const fresh = !existing;
    if (fresh) {
      // Seed directories (template files are synced by the manager).
      await rt.sandbox.commands.run(
        `mkdir -p ${SANDBOX_APP_DIR} ${SANDBOX_SKILLS_DIR}`,
        { timeoutMs: 15_000 },
      );
    }
    const previewUrl = `https://${rt.sandbox.getHost(SANDBOX_DEV_PORT)}`;
    if (opts.start) {
      this.log(rt, opts.onLog, "[e2b] starting dev server in sandbox…");
      const result = await rt.sandbox.commands.run(DEV_COMMAND, {
        timeoutMs: 300_000,
        onStdout: (l) => this.log(rt, opts.onLog, `[dev] ${l}`),
        onStderr: (l) => this.log(rt, opts.onLog, `[dev] ${l}`),
      });
      if (!result.stdout.trim().startsWith("2")) {
        throw new Error(
          `Dev server did not become healthy (HTTP ${result.stdout.trim() || "no response"})`,
        );
      }
      this.log(rt, opts.onLog, "[e2b] dev server is up");
    }
    return {
      sandboxId: rt.sandbox.sandboxId,
      previewUrl: opts.start ? previewUrl : null,
      fresh,
    };
  }

  async syncFiles(opts: {
    appId: number;
    slug: string;
    files: { path: string; content: string }[];
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = await this.connectOrCreate({
      appId: opts.appId,
      sandboxId: null,
      onLog: opts.onLog,
    });
    for (const f of opts.files) {
      const target = `${SANDBOX_APP_DIR}/${f.path}`;
      await rt.sandbox.files.write(target, f.content);
      this.log(rt, opts.onLog, `[sync] wrote ${f.path}`);
    }
  }

  async install(opts: {
    appId: number;
    slug: string;
    packages?: string[];
    onLog: (line: string) => void;
  }): Promise<ExecResult> {
    const rt = await this.connectOrCreate({
      appId: opts.appId,
      sandboxId: null,
      onLog: opts.onLog,
    });
    this.log(rt, opts.onLog, "[install] npm install…");
    const res = await rt.sandbox.commands.run(
      `cd ${SANDBOX_APP_DIR} && npm install ${opts.packages?.join(" ") ?? ""} --legacy-peer-deps --include=dev --no-audit --no-fund --prefer-offline`,
      { timeoutMs: 600_000 },
    );
    this.log(
      rt,
      opts.onLog,
      `[install] exit ${res.exitCode}${res.stderr ? ` — ${res.stderr.slice(-400)}` : ""}`,
    );
    return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
  }

  async restart(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = await this.connectOrCreate({
      appId: opts.appId,
      sandboxId: null,
      onLog: opts.onLog,
    });
    this.log(rt, opts.onLog, "[restart] killing dev server…");
    await rt.sandbox.commands.run("pkill -f 'vite' || true", {
      timeoutMs: 10_000,
    });
    await rt.sandbox.commands.run(
      `cd ${SANDBOX_APP_DIR} && nohup npm run dev -- --host 0.0.0.0 --port ${SANDBOX_DEV_PORT} --strictPort > /tmp/dev-server.log 2>&1 & sleep 3; curl -s -o /dev/null -w "%{http_code}" http://localhost:${SANDBOX_DEV_PORT}`,
      { timeoutMs: 60_000 },
    );
    this.log(rt, opts.onLog, "[restart] dev server restarted");
  }

  async rebuild(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<ExecResult> {
    const rt = await this.connectOrCreate({
      appId: opts.appId,
      sandboxId: null,
      onLog: opts.onLog,
    });
    this.log(rt, opts.onLog, "[rebuild] removing node_modules…");
    await rt.sandbox.commands.run(
      `cd ${SANDBOX_APP_DIR} && rm -rf node_modules && pkill -f vite || true`,
      { timeoutMs: 30_000 },
    );
    const install = await this.install({ ...opts });
    await this.restart(opts);
    return install;
  }

  async stop(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = this.runtime(opts.appId);
    if (!rt) return;
    await rt.sandbox.commands.run("pkill -f vite || true", {
      timeoutMs: 10_000,
    });
    this.log(rt, opts.onLog, "[stop] dev server stopped");
  }

  async dispose(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<void> {
    const rt = this.runtimes.get(opts.appId);
    if (!rt) return;
    this.runtimes.delete(opts.appId);
    try {
      await rt.sandbox.kill();
      opts.onLog("[dispose] sandbox killed");
    } catch {
      /* already gone */
    }
  }

  async exec(opts: {
    appId: number;
    slug: string;
    command: string;
    onLog: (line: string) => void;
  }): Promise<ExecResult> {
    const rt = await this.connectOrCreate({
      appId: opts.appId,
      sandboxId: null,
      onLog: opts.onLog,
    });
    const res = await rt.sandbox.commands.run(opts.command, {
      timeoutMs: 120_000,
    });
    return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
  }

  getLogs(appId: number): string[] {
    return this.runtimes.get(appId)?.logs ?? [];
  }

  async getPreviewUrl(appId: number): Promise<string | null> {
    const rt = this.runtimes.get(appId);
    if (!rt) return null;
    return `https://${rt.sandbox.getHost(SANDBOX_DEV_PORT)}`;
  }
}
