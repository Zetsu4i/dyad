/**
 * Sandbox lifecycle management for the web runtime.
 *
 * The user's E2B sandboxes cost money while running. This module hibernates
 * (pauses) every running app sandbox when the last browser client leaves:
 *
 *   - when the last WebSocket client disconnects, a grace timer starts
 *     (default 90 s — covers page reloads and flaky connections);
 *   - when it fires, every running app is stopped through the same
 *     app-run state machine the "stop-app" IPC handler uses. For E2B that
 *     PAUSES the sandbox: filesystem + node_modules are preserved and the
 *     next "run" resumes it with the same data in seconds;
 *   - any new connection cancels the timer.
 */
import { runningApps } from "@/ipc/utils/process_manager";
import { isCloudLikeRuntime, isWebRuntime } from "@/lib/schemas";

const DEFAULT_IDLE_PAUSE_MS = 90 * 1000;

function idlePauseMs(): number {
  const seconds = Number(process.env.DYAD_IDLE_PAUSE_SECONDS || "");
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  return DEFAULT_IDLE_PAUSE_MS;
}

let idleTimer: NodeJS.Timeout | null = null;

async function pauseAllRunningApps(reason: string): Promise<void> {
  const running = [...runningApps.entries()].filter(([, info]) =>
    isCloudLikeRuntime(info.mode),
  );
  if (running.length === 0) return;

  console.log(
    `[web:lifecycle] last client left (${reason}) — hibernating ${running.length} sandbox(es)...`,
  );

  const { appRunActorService } = await import(
    "@/ipc/services/app_run_actor_service"
  );
  const { randomUUID } = await import("node:crypto");

  for (const [appId] of running) {
    try {
      const snapshot = await appRunActorService.getRunState(appId);
      if (snapshot.type === "idle") continue;
      await appRunActorService.dispatchStop(appId, {
        operationId: randomUUID(),
        startedAt: Date.now(),
        activeInvocationRef: snapshot.invocationRef,
      });
      console.log(`[web:lifecycle] app ${appId} paused (data preserved)`);
    } catch (error) {
      console.warn(
        `[web:lifecycle] failed to pause app ${appId}:`,
        (error as Error).message,
      );
    }
  }
}

/** Called when a WebSocket client connects. */
export function onClientConnected(): void {
  if (!isWebRuntime()) return;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
    console.log("[web:lifecycle] client connected — idle hibernation cancelled");
  }
}

/** Called when a WebSocket client disconnects. */
export function onClientDisconnected(clientCount: number): void {
  if (!isWebRuntime()) return;
  if (clientCount > 0) return;
  const ms = idlePauseMs();
  if (ms === 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  console.log(
    `[web:lifecycle] no clients left — hibernating sandboxes in ${Math.round(ms / 1000)}s`,
  );
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void pauseAllRunningApps("idle timeout").catch((e) =>
      console.warn("[web:lifecycle] hibernation failed:", e?.message),
    );
  }, ms);
  idleTimer.unref?.();
}
