/**
 * Dyad web server — runs the ENTIRE Dyad main-process backend
 * (src/ipc/** handlers, pro agent engine, db, git versioning) in a plain
 * Node process and bridges the Electron IPC surface over WebSocket.
 *
 *   Browser  <──WS /__dyad_ipc──>  web_server  ──>  ipcMain registry (dyad handlers)
 *                                          └────>  E2B sandboxes (app execution)
 *
 * The renderer build (dist/renderer) is served as static files. The client
 * bridge (src/web/renderer_ipc_bridge.ts) installs `window.electron.ipcRenderer`
 * backed by this WebSocket, mirroring src/preload.ts semantics exactly.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

// The "electron" import is rewritten to the shim by the bundler alias.
import { app, ipcMain, createWebWindowSession, WebContentsShim } from "./electron_shim";

const PORT = Number(process.env.PORT || 3000);
const RENDERER_DIR = path.resolve(
  process.env.DYAD_RENDERER_DIR || path.join(process.cwd(), "dist", "renderer"),
);

// ---------------------------------------------------------------------------
// Server boot
// ---------------------------------------------------------------------------

async function main() {
  console.log("[web] booting dyad web server...");

  // Keep the userData dir deterministic in dev and prod.
  if (process.env.NODE_ENV === "development" && !process.env.DYAD_DEV_USER_DATA_DIR) {
    process.env.DYAD_DEV_USER_DATA_DIR = app.getPath("userData");
  }

  // ---- backend imports (pulled in AFTER the shim is importable) ----
  const { registerIpcHandlers } = await import("@/ipc/ipc_host");
  const { initializeDatabase } = await import("@/db");
  const { readEffectiveSettings } = await import("@/main/settings");
  const { gitAddSafeDirectory } = await import("@/ipc/utils/git_utils");
  const { getDyadAppsBaseDirectory } = await import("@/paths/paths");
  const { seedWebDefaults } = await import("@/web/seed");

  try {
    initializeDatabase();
    console.log("[web] database initialized at", app.getPath("userData"));
  } catch (error) {
    console.error("[web] FATAL: database initialization failed", error);
    process.exit(1);
  }

  // First-boot seeding: E2B key, default custom provider + model, runtime mode.
  try {
    await seedWebDefaults();
  } catch (error) {
    console.warn("[web] seeding failed:", (error as Error).message);
  }

  registerIpcHandlers();
  console.log("[web] IPC handlers registered:", (ipcMain as any).hasHandler ? "ok" : "?");

  // Recover interrupted subagents / background jobs (best-effort, non-blocking).
  try {
    const { recoverInterruptedSubagents } = await import(
      "@/pro/main/ipc/handlers/local_agent/subagents/subagent_manager"
    );
    void recoverInterruptedSubagents().catch((e) =>
      console.warn("[web] subagent recovery failed:", e?.message),
    );
  } catch (e) {
    console.warn("[web] subagent recovery unavailable:", (e as Error).message);
  }

  try {
    const settings = await readEffectiveSettings();
    console.log(
      "[web] effective settings loaded — runtimeMode2:",
      settings.runtimeMode2 ?? "unset",
    );
  } catch (e) {
    console.warn("[web] settings read failed:", (e as Error).message);
  }

  // git safe.directory for the apps workspace
  try {
    gitAddSafeDirectory(`${getDyadAppsBaseDirectory()}/*`);
  } catch (e) {
    console.warn("[web] gitAddSafeDirectory failed:", (e as Error).message);
  }

  // Reconcile E2B sandboxes from a previous server run (resume paused ones
  // lazily; destroy orphans whose apps no longer exist).
  try {
    const { reconcileE2bSandboxes } = await import("@/ipc/utils/e2b_sandbox_provider");
    void reconcileE2bSandboxes().catch((e) =>
      console.warn("[web] E2B reconcile failed:", e?.message),
    );
  } catch (e) {
    console.warn("[web] E2B provider unavailable:", (e as Error).message);
  }

  await startHttpServer();
}

// ---------------------------------------------------------------------------
// Static renderer + WebSocket IPC bridge
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  // Health check
  if (pathname === "/__dyad_health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, dyad: "web", time: Date.now() }));
    return;
  }

  let filePath = path.normalize(path.join(RENDERER_DIR, pathname));
  if (!filePath.startsWith(RENDERER_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    /* fall through to SPA fallback */
  }
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    try {
      stat = fs.statSync(filePath);
    } catch {
      stat = null;
    }
  }

  // SPA fallback for client-side routes (/,/chat,/settings,...)
  if (!stat && !path.extname(pathname)) {
    filePath = path.join(RENDERER_DIR, "index.html");
    try {
      stat = fs.statSync(filePath);
    } catch {
      stat = null;
    }
  }

  if (!stat) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(
      `Dyad web renderer not found at ${RENDERER_DIR}. Run "npm run web:build-renderer" first.`,
    );
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function startHttpServer(): Promise<void> {
  const server = http.createServer(serveStatic);

  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({ noServer: true, path: "/__dyad_ipc" });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/__dyad_ipc") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: import("ws").WebSocket, req: http.IncomingMessage) => {
    const origin =
      req.headers.origin ||
      `http://${req.headers.host || `localhost:${PORT}`}`;

    // Configure the renderer trust policy once, from the first connection's
    // origin (the browser always connects same-origin).
    try {
      const { configureTrustedRenderer } = require("@/ipc/utils/renderer_security");
      configureTrustedRenderer({
        devServerUrl: String(origin),
        packagedRendererUrl: "file:///index.html",
      });
    } catch {
      /* already configured with a matching policy */
    }

    const windowSession = createWebWindowSession(String(origin));
    const webContents: WebContentsShim = windowSession.webContents;
    webContents.onOutgoingEvent = (channel, args) => {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(
          JSON.stringify({ v: 1, type: "event", channel, args }),
        );
      }
    };

    const fakeEvent = {
      sender: webContents,
      senderFrame: webContents.senderFrame,
      processId: 1,
      frameId: webContents.id,
      preventDefault: () => {},
    };

    const pendingInvokes = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let invokeCounter = 0;
    let alive = true;

    ws.on("message", async (raw: import("ws").RawData, isBinary: boolean) => {
      if (isBinary) return;
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "invoke" && typeof msg.channel === "string") {
        const id = Number(msg.id);
        // JSON transports `undefined` as `null`; dyad's void-input contracts
        // validate against z.void() which rejects null. Restore undefined at
        // the top level (nested nulls inside objects stay untouched).
        const args = (Array.isArray(msg.args) ? msg.args : []).map(
          (a: unknown) => (a === null ? undefined : a),
        );
        try {
          const result = await (ipcMain as any).dispatchInvoke(
            msg.channel,
            fakeEvent,
            ...args,
          );
          if (alive) {
            ws.send(
              JSON.stringify({ v: 1, type: "result", id, ok: true, payload: result }),
            );
          }
        } catch (error) {
          const err = error as Error;
          if (alive) {
            ws.send(
              JSON.stringify({
                v: 1,
                type: "result",
                id,
                ok: false,
                error: {
                  message: err?.message || String(error),
                  name: err?.name || "Error",
                  kind: (error as any)?.kind,
                  stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
                },
              }),
            );
          }
        }
        return;
      }

      if (msg.type === "send" && typeof msg.channel === "string") {
        const sendArgs = (Array.isArray(msg.args) ? msg.args : []).map(
          (a: unknown) => (a === null ? undefined : a),
        );
        try {
          (ipcMain as any).dispatchSend(
            msg.channel,
            fakeEvent,
            ...sendArgs,
          );
        } catch (error) {
          console.error(
            `[web] send channel "${msg.channel}" failed:`,
            (error as Error).message,
          );
        }
        return;
      }
    });

    ws.on("close", () => {
      alive = false;
      webContents.destroy();
      try {
        const { onClientDisconnected } = require("@/web/sandbox_lifecycle");
        onClientDisconnected(wss.clients.size);
      } catch {
        /* lifecycle hooks are best-effort */
      }
    });

    ws.on("error", () => {
      alive = false;
    });

    try {
      const { onClientConnected } = require("@/web/sandbox_lifecycle");
      onClientConnected();
    } catch {
      /* lifecycle hooks are best-effort */
    }
  });

  await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  console.log(`[web] Dyad web server listening on http://localhost:${PORT}`);
  console.log(`[web] renderer dir: ${RENDERER_DIR}`);
  console.log(`[web] data dir: ${app.getPath("userData")}`);
}

main().catch((error) => {
  console.error("[web] FATAL boot error", error);
  process.exit(1);
});
