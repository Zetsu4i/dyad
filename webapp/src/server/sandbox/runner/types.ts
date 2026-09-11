/**
 * Sandbox runner contract.
 *
 * Dyad Cloud builds and hosts every app inside a sandbox:
 *  - "e2b"   → an E2B cloud sandbox (production path, user-provided API key)
 *  - "local" → processes on the host machine (self-hosted/dev fallback)
 *
 * Both runners expose the same surface so the chat pipeline, file sync,
 * dependency installation and preview URLs are runner-agnostic.
 */

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxFile {
  path: string;
  content: string;
}

export interface EnsureResult {
  sandboxId: string;
  previewUrl: string | null;
  fresh: boolean;
}

export interface AppRunner {
  readonly kind: "e2b" | "local";

  /** Create or resume the sandbox and (re)start the dev server if desired. */
  ensure(opts: {
    appId: number;
    slug: string;
    sandboxId: string | null;
    start: boolean;
    onLog: (line: string) => void;
  }): Promise<EnsureResult>;

  /** Write/update files inside the sandbox. */
  syncFiles(opts: {
    appId: number;
    slug: string;
    files: SandboxFile[];
    onLog: (line: string) => void;
  }): Promise<void>;

  /** Install / refresh npm dependencies (package.json changes). */
  install(opts: {
    appId: number;
    slug: string;
    packages?: string[];
    onLog: (line: string) => void;
  }): Promise<ExecResult>;

  /** Restart the dev server. */
  restart(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<void>;

  /** Full rebuild: remove node_modules, install, restart. */
  rebuild(opts: {
    appId: number;
    slug: string;
    onLog: (line: string) => void;
  }): Promise<ExecResult>;

  /** Stop the dev server (sandbox stays resumable where supported). */
  stop(opts: { appId: number; slug: string; onLog: (line: string) => void }): Promise<void>;

  /** Tear down the sandbox entirely. */
  dispose(opts: { appId: number; slug: string; onLog: (line: string) => void }): Promise<void>;

  /** Run an arbitrary shell command inside the sandbox (skills/MCP tooling). */
  exec(opts: {
    appId: number;
    slug: string;
    command: string;
    onLog: (line: string) => void;
  }): Promise<ExecResult>;

  /** Recent combined log lines for the app. */
  getLogs(appId: number): string[];

  /** Current preview URL, if the dev server is reachable. */
  getPreviewUrl(appId: number): Promise<string | null>;
}

/** Paths inside the sandbox where the app lives. */
export const SANDBOX_APP_DIR = "/home/user/app";
export const SANDBOX_SKILLS_DIR = "/home/user/skills";
export const SANDBOX_DEV_PORT = 8080;

/** Guard against path traversal in dyad-write/rename/delete tags. */
export function safeAppPath(p: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error(`Unsafe file path from model: ${p}`);
  }
  return normalized;
}
