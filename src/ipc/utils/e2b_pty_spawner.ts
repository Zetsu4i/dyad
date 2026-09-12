/**
 * E2B-backed PTY spawner for dyad's terminal panel.
 *
 * PtySessionManager (src/ipc/utils/pty_session_manager.ts) is dependency-
 * injected with a `ptySpawner` — node-pty in desktop mode. In E2B web mode
 * we return a TerminalPtyProcess backed by a real PTY inside the app's E2B
 * sandbox (sandbox.pty.create), so xterm.js talks to a genuine shell running
 * next to the dev server, with the app's working directory.
 *
 * The spawner interface is synchronous, so the async E2B handle is created
 * lazily and stdin writes are queued until it resolves.
 */
import { getActiveE2bProvider } from "./cloud_sandbox_provider";
import { isE2bRuntimeMode } from "./e2b_sandbox_provider";
import type {
  TerminalPtyProcess,
  TerminalPtySpawner,
} from "./pty_session_manager";

function spawnE2bPty(
  _file: string,
  _args: string[],
  options: {
    cols: number;
    rows: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    name: string;
  },
): TerminalPtyProcess {
  const dataCallbacks = new Set<(data: string) => void>();
  const exitCallbacks = new Set<(event: {
    exitCode: number | null;
    signal?: number | null;
  }) => void>();

  let activeHandle: {
    pid: number;
    kill(): Promise<boolean>;
  } | null = null;
  let activePtyInput: {
    sendInput(pid: number, data: Uint8Array): Promise<void>;
  } | null = null;
  let activePtyModule: {
    resize(
      pid: number,
      size: { cols: number; rows: number },
    ): Promise<void>;
  } | null = null;
  const writeQueue: string[] = [];
  let exited = false;

  const emitData = (data: string): void => {
    for (const cb of dataCallbacks) {
      try {
        cb(data);
      } catch {
        /* listener error */
      }
    }
  };

  const emitExit = (exitCode: number | null): void => {
    if (exited) return;
    exited = true;
    for (const cb of exitCallbacks) {
      try {
        cb({ exitCode });
      } catch {
        /* listener error */
      }
    }
  };

  void (async () => {
    const provider = getActiveE2bProvider();
    if (!provider) {
      emitData(
        "\r\n\x1b[31mE2B runtime is not active.\x1b[0m\r\n" +
          "Enable it in Settings, then restart the server.\r\n",
      );
      emitExit(1);
      return;
    }

    const appId = provider.findAppIdByPath(options.cwd);
    if (appId == null) {
      emitData(
        "\r\n\x1b[33mNo E2B sandbox for this app yet.\x1b[0m\r\n" +
          "Start the app preview first — this terminal lives inside the app's E2B sandbox.\r\n",
      );
      emitExit(1);
      return;
    }

    try {
      const { handle, ptyModule } = await provider.openPty(appId, {
        cols: options.cols,
        rows: options.rows,
        onData: (data: Uint8Array) => emitData(Buffer.from(data).toString("utf8")),
      });
      activeHandle = handle;
      activePtyModule = ptyModule;
      activePtyInput = ptyModule;

      void handle
        .wait()
        .then((result) => emitExit(result.exitCode ?? 0))
        .catch(() => emitExit(1));

      // Flush queued stdin writes.
      for (const data of writeQueue.splice(0)) {
        void ptyModule
          .sendInput(handle.pid, Buffer.from(data, "utf8"))
          .catch(() => {});
      }
    } catch (error) {
      emitData(
        `\r\n\x1b[31mFailed to open sandbox terminal: ${(error as Error).message}\x1b[0m\r\n`,
      );
      emitExit(1);
    }
  })();

  return {
    write(data: string): void {
      if (activeHandle && activePtyInput) {
        // PTY input goes through pty.sendInput (sendStdin is for commands).
        void activePtyInput
          .sendInput(activeHandle.pid, Buffer.from(data, "utf8"))
          .catch(() => {});
      } else if (!exited) {
        writeQueue.push(data);
      }
    },
    resize(cols: number, rows: number): void {
      if (activeHandle && activePtyModule) {
        void activePtyModule
          .resize(activeHandle.pid, { cols, rows })
          .catch(() => {});
      }
    },
    onData(cb: (data: string) => void): { dispose(): void } {
      dataCallbacks.add(cb);
      return { dispose: () => dataCallbacks.delete(cb) };
    },
    onExit(
      cb: (event: { exitCode: number | null; signal?: number | null }) => void,
    ): { dispose(): void } {
      exitCallbacks.add(cb);
      return { dispose: () => exitCallbacks.delete(cb) };
    },
  };
}

/**
 * Chooses the PTY spawner for the current runtime mode: node-pty locally,
 * an E2B sandbox PTY in web/e2b mode.
 */
export function getRuntimePtySpawner(): TerminalPtySpawner {
  if (isE2bRuntimeMode()) {
    return spawnE2bPty as unknown as TerminalPtySpawner;
  }
  // Lazy require so the native module loads only in host mode.
  const { spawn } = require("node-pty") as typeof import("node-pty");
  return spawn as unknown as TerminalPtySpawner;
}
