/**
 * E2B command router.
 *
 * Routes command execution for agent tools (run_build, run_pre_commit,
 * add_dependency, run_tests, ...) into the app's E2B sandbox when the web
 * runtime mode is "e2b" and the command's cwd belongs to an app with a live
 * sandbox. Everything else falls through to local execution.
 *
 * Server app working directories map onto E2B_APP_ROOT inside the sandbox.
 */
import {
  e2bSandboxProvider,
  isE2bRuntimeMode,
  E2B_APP_ROOT,
} from "./e2b_sandbox_provider";
import type { BufferedProcessOptions, BufferedProcessResult } from "./buffered_process";
import type { SpawnStreamingResult } from "./spawn_streaming";

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildCommandLine(command: string, args: readonly string[]): string {
  if (args.length === 0) return command;
  return `${command} ${args.map(shellQuote).join(" ")}`;
}

/** Resolves the live E2B app for a server-side cwd, or null. */
function resolveE2bApp(
  cwd: string | undefined,
): { appId: number } | null {
  if (!isE2bRuntimeMode() || !cwd) return null;
  const appId = e2bSandboxProvider.findAppIdByPath(cwd);
  if (appId == null) return null;
  if (!e2bSandboxProvider.getLiveStateForApp(appId)) return null;
  return { appId };
}

/**
 * E2B implementation of runBufferedProcess. Returns null when the command
 * should NOT be routed to a sandbox (fall back to local execution).
 */
export async function tryRunBufferedProcessInE2b(
  options: BufferedProcessOptions,
): Promise<BufferedProcessResult | null> {
  const app = resolveE2bApp(options.cwd);
  if (!app) return null;

  if (options.signal?.aborted) {
    return {
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      aborted: true,
      timedOut: false,
    };
  }

  const commandLine = options.shell
    ? options.args?.length
      ? `${options.command} ${options.args.map(shellQuote).join(" ")}`
      : options.command
    : buildCommandLine(options.command, options.args ?? []);

  const startedAt = Date.now();
  try {
    const result = await e2bSandboxProvider.runInSandbox(app.appId, commandLine, {
      cwd: E2B_APP_ROOT,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      onStdout: (data) => options.onStdout?.(data, null),
      onStderr: (data) => options.onStderr?.(data, null),
    });

    const elapsed = Date.now() - startedAt;
    const timedOut =
      result.exitCode !== 0 &&
      elapsed >= (options.timeoutMs ?? 10 * 60_000) - 1500;

    return {
      code: result.exitCode,
      signal: null,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: false,
      stderrTruncated: false,
      aborted: false,
      timedOut,
    };
  } catch (error) {
    // Sandbox not reachable etc. — surface as a failed process rather than
    // falling back to local execution (which would touch the wrong machine).
    return {
      code: 127,
      signal: null,
      stdout: "",
      stderr: `[e2b] command failed: ${(error as Error).message}`,
      stdoutTruncated: false,
      stderrTruncated: false,
      aborted: false,
      timedOut: false,
    };
  }
}

/**
 * E2B implementation of spawnStreaming. Returns null when not routed.
 */
export async function trySpawnStreamingInE2b({
  command,
  args = [],
  cwd,
  signal,
  onOutput,
  timeoutMs,
}: {
  command: string;
  args?: string[];
  cwd: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  timeoutMs?: number;
}): Promise<SpawnStreamingResult | null> {
  const app = resolveE2bApp(cwd);
  if (!app) return null;

  if (signal?.aborted) {
    return { code: null, stdout: "", stderr: "", aborted: true, timedOut: false };
  }

  const commandLine = buildCommandLine(command, args);
  const startedAt = Date.now();
  try {
    const result = await e2bSandboxProvider.runInSandbox(app.appId, commandLine, {
      cwd: E2B_APP_ROOT,
      timeoutMs: timeoutMs ?? 10 * 60_000,
      onStdout: (data) => onOutput?.(data),
      onStderr: (data) => onOutput?.(data),
    });
    const elapsed = Date.now() - startedAt;
    const timedOut =
      result.exitCode !== 0 && elapsed >= (timeoutMs ?? 10 * 60_000) - 1500;
    return {
      code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      aborted: false,
      timedOut,
    };
  } catch (error) {
    return {
      code: 127,
      stdout: "",
      stderr: `[e2b] command failed: ${(error as Error).message}`,
      aborted: false,
      timedOut: false,
    };
  }
}

/**
 * E2B implementation of socket_firewall.runCommand ({stdout, stderr}).
 * Returns null when not routed.
 */
export async function tryRunCommandInE2b({
  command,
  args,
  cwd,
  timeoutMs,
}: {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string } | null> {
  const app = resolveE2bApp(cwd);
  if (!app) return null;

  const commandLine = buildCommandLine(command, args);
  try {
    const result = await e2bSandboxProvider.runInSandbox(app.appId, commandLine, {
      cwd: E2B_APP_ROOT,
      timeoutMs: timeoutMs ?? 10 * 60_000,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    throw new Error(`[e2b] command failed: ${(error as Error).message}`);
  }
}
