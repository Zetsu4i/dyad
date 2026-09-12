/**
 * Web renderer IPC bridge.
 *
 * In Electron, src/preload.ts exposes `window.electron.ipcRenderer` through
 * the contextBridge. On the web, this module installs the SAME surface backed
 * by a WebSocket connection to the dyad web server (/__dyad_ipc).
 *
 * Semantics mirrored from preload.ts exactly:
 *  - channel whitelist (VALID_INVOKE_CHANNELS / VALID_SEND_CHANNELS /
 *    VALID_RECEIVE_CHANNELS + dynamic terminal:data:* / terminal:exit:*)
 *  - invoke() unwraps the dyad-ipc-envelope-v1 response
 *  - invokeEnvelope() returns the raw envelope
 *  - on() strips the Electron event arg and returns an unsubscribe fn
 *  - send() is fire-and-forget (safe during pagehide)
 *
 * This module is imported at the very top of src/renderer.tsx and is a no-op
 * when running inside Electron (window.electron already exists).
 */

import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import {
  VALID_INVOKE_CHANNELS,
  VALID_RECEIVE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "@/ipc/preload/channels";

type Listener = (...args: unknown[]) => void;

function isValidDynamicReceiveChannel(channel: string): boolean {
  return (
    channel.startsWith("terminal:data:") || channel.startsWith("terminal:exit:")
  );
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/__dyad_ipc`;
}

interface BridgeMessage {
  v?: number;
  type: string;
  id?: number;
  channel?: string;
  args?: unknown[];
  ok?: boolean;
  payload?: unknown;
  error?: { message: string; name?: string; kind?: unknown; stack?: string };
}

class WebIpcRenderer {
  private ws: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private pendingInvokes = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private invokeCounter = 0;
  private sendQueue: Array<{ channel: string; args: unknown[] }> = [];
  private everConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ------------------------------------------------------------------ socket

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(wsUrl());

      const openHandler = () => {
        settled = true;
        this.ws = socket;
        this.everConnected = true;
        this.connecting = null;
        // Flush queued fire-and-forget messages.
        const queue = this.sendQueue.splice(0);
        for (const item of queue) this.rawSend(item.channel, item.args);
        resolve(socket);
      };
      const failHandler = () => {
        if (!settled) {
          settled = true;
          this.connecting = null;
          reject(new Error("dyad web bridge: WebSocket connection failed"));
          setTimeout(() => this.scheduleReconnect(), 1000);
        }
      };

      socket.addEventListener("open", openHandler);
      socket.addEventListener("error", failHandler);
      socket.addEventListener("close", () => {
        if (this.ws === socket) this.ws = null;
        if (!settled) failHandler();
        else this.scheduleReconnect();
      });
      socket.addEventListener("message", (ev: MessageEvent) => {
        this.handleMessage(String(ev.data));
      });
    });

    return this.connecting;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        /* scheduleReconnect is triggered by the close handler */
      });
    }, 1500);
  }

  private handleMessage(raw: string): void {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "result" && typeof msg.id === "number") {
      const pending = this.pendingInvokes.get(msg.id);
      if (!pending) return;
      this.pendingInvokes.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.payload);
      } else {
        const err = new Error(msg.error?.message || "IPC invoke failed");
        (err as any).name = msg.error?.name;
        (err as any).kind = msg.error?.kind;
        if (msg.error?.stack) (err as any).stack = msg.error.stack;
        pending.reject(err);
      }
      return;
    }

    if (msg.type === "event" && typeof msg.channel === "string") {
      const args = Array.isArray(msg.args) ? msg.args : [];
      const set = this.listeners.get(msg.channel);
      if (set) {
        for (const listener of [...set]) {
          try {
            listener(...args);
          } catch (error) {
            console.error(
              `[dyad-web-bridge] listener on "${msg.channel}" failed`,
              error,
            );
          }
        }
      }
    }
  }

  private rawSend(channel: string, args: unknown[]): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ v: 1, type: "send", channel, args }));
  }

  // ------------------------------------------------------------- ipc surface

  invoke = async (
    channel: string,
    ...args: unknown[]
  ): Promise<unknown> => {
    if (!(VALID_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }
    const response = await this.invokeRaw(channel, ...args);
    if (isIpcInvokeEnvelope(response)) {
      return unwrapIpcEnvelope(response);
    }
    return response;
  };

  invokeEnvelope = async (
    channel: string,
    ...args: unknown[]
  ): Promise<unknown> => {
    if (!(VALID_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }
    return this.invokeRaw(channel, ...args);
  };

  /** Shared invoke core returning the RAW (envelope) response. */
  private invokeRaw = async (
    channel: string,
    ...args: unknown[]
  ): Promise<unknown> => {
    const socket = await this.connect();
    const id = ++this.invokeCounter;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingInvokes.set(id, { resolve, reject });
      // Safety timeout: never hang the UI forever on a dead socket.
      setTimeout(() => {
        if (this.pendingInvokes.has(id)) {
          this.pendingInvokes.delete(id);
          reject(new Error(`IPC invoke "${channel}" timed out`));
        }
      }, 10 * 60 * 1000);
    });
    socket.send(JSON.stringify({ v: 1, type: "invoke", id, channel, args }));
    return promise;
  };

  send = (channel: string, ...args: unknown[]): void => {
    if (!(VALID_SEND_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }
    // Fire-and-forget: queue while disconnected, flush on connect.
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.sendQueue.push({ channel, args });
      if (this.sendQueue.length > 200) this.sendQueue.shift();
      void this.connect().catch(() => {
        /* dropped */
      });
      return;
    }
    this.rawSend(channel, args);
  };

  on = (channel: string, listener: Listener): (() => void) => {
    if (
      !(VALID_RECEIVE_CHANNELS as readonly string[]).includes(channel) &&
      !isValidDynamicReceiveChannel(channel)
    ) {
      throw new Error(`Invalid channel: ${channel}`);
    }
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    void this.connect().catch(() => {
      /* events resume on reconnect */
    });
    return () => {
      set!.delete(listener);
    };
  };

  removeAllListeners = (channel: string): void => {
    if (
      !(VALID_RECEIVE_CHANNELS as readonly string[]).includes(channel) &&
      !isValidDynamicReceiveChannel(channel)
    ) {
      return;
    }
    this.listeners.delete(channel);
  };

  removeListener = (channel: string, listener: Listener): void => {
    if (
      !(VALID_RECEIVE_CHANNELS as readonly string[]).includes(channel) &&
      !isValidDynamicReceiveChannel(channel)
    ) {
      return;
    }
    this.listeners.get(channel)?.delete(listener);
  };

  /** Used by the app to check connectivity (debug / status UI). */
  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

declare global {
  interface Window {
    electron?: {
      ipcRenderer: WebIpcRenderer;
      webFrame?: { setZoomFactor: (f: number) => void; getZoomFactor: () => number };
    };
  }
}

export function installWebIpcBridge(): void {
  if (typeof window === "undefined") return;
  if (window.electron?.ipcRenderer) {
    // Running inside Electron with the real preload — do nothing.
    return;
  }
  const renderer = new WebIpcRenderer();
  window.electron = {
    ipcRenderer: renderer as any,
    webFrame: {
      setZoomFactor: () => {},
      getZoomFactor: () => 1,
    },
  };
  // Kick off the connection eagerly so the app's first queries are fast.
  void renderer.invoke("get-app-version").catch(() => {
    /* connection errors surface through query retries */
  });
}

installWebIpcBridge();
