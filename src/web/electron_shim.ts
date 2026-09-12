/**
 * Electron API shim for the Dyad web server.
 *
 * The entire Dyad main-process backend (src/ipc/**, src/pro/**, src/db/**) is
 * written against Electron's `app`, `ipcMain`, `BrowserWindow`, `safeStorage`,
 * ... APIs. This module reimplements that surface for a plain Node process so
 * the backend can run as a web server:
 *
 *  - `app.getPath(...)`        -> a server-side data directory
 *  - `ipcMain.handle/on`       -> an in-process handler registry driven over
 *                                  WebSocket by src/web/web_server.ts
 *  - `BrowserWindow`           -> WebWindowSession objects; one per WebSocket
 *                                  client ("every browser tab is a window")
 *  - `safeStorage`             -> AES-256-GCM with a persisted server key
 *  - `nativeTheme`             -> always dark
 *  - `dialog`/`shell`/...      -> safe no-ops
 *
 * The server bundle is built with `--alias:electron=<this file>`, so every
 * `import ... from "electron"` in the backend graph resolves here.
 */
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Marks this process as the web (SaaS) runtime. Backend code checks this via
 * isWebRuntime() (src/lib/schemas.ts) to unlock pro-tier agent features and
 * force E2B-only sandbox execution. Set here — at the top of the module that
 * replaces `electron` in the server bundle — so it is always defined no
 * matter which esbuild entry/config produced the bundle.
 */
declare global {
  // eslint-disable-next-line no-var
  var __DYAD_WEB__: boolean | undefined;
}
globalThis.__DYAD_WEB__ = true;

// ---------------------------------------------------------------------------
// Data directory layout (mirrors Electron's userData layout)
// ---------------------------------------------------------------------------

function resolveRepoRoot(): string {
  if (__dirname && __dirname.length > 0) {
    return path.resolve(__dirname, "..", "..");
  }
  return process.cwd();
}

export const WEB_DATA_DIR = path.resolve(
  process.env.DYAD_WEB_DATA_DIR || path.join(resolveRepoRoot(), ".web-data"),
);

const USER_DATA_DIR = path.join(WEB_DATA_DIR, "user-data");

function ensureDir(dir: string): string {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

ensureDir(USER_DATA_DIR);
ensureDir(path.join(USER_DATA_DIR, "dyad-apps"));

// Pretend to be Electron so dyad's `getElectron()` helper
// (src/paths/paths.ts) picks this module up through `require("electron")`.
(process.versions as Record<string, string | undefined>).electron =
  process.versions.electron || "34.2.0";

// ---------------------------------------------------------------------------
// Web window sessions ("every WebSocket client is a BrowserWindow")
// ---------------------------------------------------------------------------

export interface WebSessionFrame {
  url: string;
  parent: null;
  processId: number;
  routingId: number;
}

let nextWebContentsId = 1;

/**
 * A fake WebContents backed by a WebSocket connection. Events sent through
 * `send(channel, payload)` are serialized to the client by web_server.ts.
 */
export class WebContentsShim extends EventEmitter {
  readonly id: number;
  private destroyed = false;
  private readonly frame: WebSessionFrame;
  /** Installed by web_server.ts: (channel, args[]) => void */
  onOutgoingEvent: (channel: string, args: unknown[]) => void = () => {};

  constructor(origin: string) {
    super();
    this.id = nextWebContentsId++;
    this.frame = {
      url: origin,
      parent: null,
      processId: 1,
      routingId: this.id,
    };
  }

  get mainFrame(): WebSessionFrame {
    return this.frame;
  }

  get senderFrame(): WebSessionFrame {
    return this.frame;
  }

  get webContents(): WebContentsShim {
    return this;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isCrashed(): boolean {
    return false;
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) return;
    try {
      this.onOutgoingEvent(channel, args);
    } catch {
      /* dropped */
    }
  }

  postMessage(channel: string, payload: unknown): void {
    this.send(channel, payload);
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    if (event === "destroyed") {
      const wrapped = () => listener();
      return super.once(event, wrapped) as this;
    }
    return super.once(event, listener) as this;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
  }

  // Electron APIs occasionally touched on WebContents in the backend.
  getURL(): string {
    return this.frame.url;
  }
  focus(): void {}
  reload(): void {}
  print(): void {}
  toggleDevTools(): void {}
  executeJavaScript(): Promise<unknown> {
    return Promise.resolve(undefined);
  }
  sendToFrame(): void {}
  get process() {
    return { type: "renderer", pid: process.pid };
  }
}

/**
 * A fake BrowserWindow wrapping a WebContentsShim. Registered in the
 * BrowserWindow registry so `BrowserWindow.getAllWindows()` /
 * `windowRegistry` fan-out works exactly like Electron multi-window.
 */
export class BrowserWindowShim {
  readonly webContents: WebContentsShim;
  readonly id: number;

  constructor(origin: string) {
    this.webContents = new WebContentsShim(origin);
    this.id = this.webContents.id;
  }

  getBounds() {
    return { x: 0, y: 0, width: 1440, height: 900 };
  }
  getPosition() {
    return [0, 0];
  }
  setSize(): void {}
  isDestroyed(): boolean {
    return this.webContents.isDestroyed();
  }
  isMinimized(): boolean {
    return false;
  }
  isMaximized(): boolean {
    return true;
  }
  minimize(): void {}
  maximize(): void {}
  unmaximize(): void {}
  restore(): void {}
  close(): void {
    this.webContents.destroy();
    const i = allWindows.indexOf(this);
    if (i >= 0) allWindows.splice(i, 1);
  }
  focus(): void {}
  blur(): void {}
  show(): void {}
  hide(): void {}
  isVisible(): boolean {
    return true;
  }
  setTitle(): void {}
  setFullScreen(): void {}
  isFullScreen(): boolean {
    return false;
  }
  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  removeListener(): this {
    return this;
  }
  removeAllListeners(): this {
    return this;
  }
  setMenuBarVisibility(): void {}
  reload(): void {}
}

const allWindows: BrowserWindowShim[] = [];

export const BrowserWindow = {
  getAllWindows(): BrowserWindowShim[] {
    return allWindows.filter((w) => !w.isDestroyed());
  },
  fromWebContents(wc: unknown): BrowserWindowShim | null {
    return (
      allWindows.find((w) => w.webContents === (wc as WebContentsShim)) || null
    );
  },
  fromId(id: number): BrowserWindowShim | null {
    return allWindows.find((w) => w.id === id) || null;
  },
  getFocusedWindow(): BrowserWindowShim | null {
    return BrowserWindow.getAllWindows()[0] ?? null;
  },
  // Constructor-style usage guard: backend should not construct windows.
} as unknown as {
  new (opts?: unknown): BrowserWindowShim;
  getAllWindows(): BrowserWindowShim[];
  fromWebContents(wc: unknown): BrowserWindowShim | null;
  fromId(id: number): BrowserWindowShim | null;
  getFocusedWindow(): BrowserWindowShim | null;
};

/** Creates + registers a web window session for a WebSocket client. */
export function createWebWindowSession(origin: string): BrowserWindowShim {
  const win = new BrowserWindowShim(origin);
  allWindows.push(win);
  return win;
}

// ---------------------------------------------------------------------------
// ipcMain — in-process handler registry driven over WebSocket
// ---------------------------------------------------------------------------

type IpcMainHandler = (event: any, ...args: unknown[]) => unknown;
type IpcMainListener = (event: any, ...args: unknown[]) => void;

class IpcMainShim extends EventEmitter {
  private handleRegistry = new Map<string, IpcMainHandler>();

  handle(channel: string, handler: IpcMainHandler): void {
    this.handleRegistry.set(channel, handler);
  }

  removeHandler(channel: string): void {
    this.handleRegistry.delete(channel);
  }

  removeHandlers?(): void {
    this.handleRegistry.clear();
  }

  hasHandler(channel: string): boolean {
    return this.handleRegistry.has(channel);
  }

  /** Invoked by web_server.ts when a WS client performs an `invoke`. */
  async dispatchInvoke(
    channel: string,
    event: any,
    ...args: unknown[]
  ): Promise<unknown> {
    const handler = this.handleRegistry.get(channel);
    if (!handler) {
      throw new Error(`No IPC handler registered for channel "${channel}"`);
    }
    return handler(event, ...args);
  }

  on(channel: string, listener: IpcMainListener): this {
    return super.on(channel, listener);
  }

  /** Invoked by web_server.ts when a WS client sends a fire-and-forget. */
  dispatchSend(channel: string, event: any, ...args: unknown[]): void {
    const listeners = this.listeners(channel) as IpcMainListener[];
    for (const listener of listeners) {
      try {
        listener(event, ...args);
      } catch (error) {
        console.error(`[web] ipcMain.on("${channel}") listener failed`, error);
      }
    }
  }

  removeAllListeners(channel?: string): this {
    if (channel) {
      // Keep invoke handlers; only drop event listeners.
      return super.removeAllListeners(channel);
    }
    return super.removeAllListeners();
  }
}

export const ipcMain = new IpcMainShim() as unknown as import("electron").IpcMain & {
  dispatchInvoke(channel: string, event: any, ...args: unknown[]): Promise<unknown>;
  dispatchSend(channel: string, event: any, ...args: unknown[]): void;
};

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

const appEmitter = new EventEmitter();

const appPaths: Record<string, string> = {
  userData: USER_DATA_DIR,
  sessionData: USER_DATA_DIR,
  home: os.homedir(),
  temp: os.tmpdir(),
  exe: process.execPath,
  desktop: path.join(os.homedir(), "Desktop"),
  documents: path.join(os.homedir(), "Documents"),
  downloads: path.join(os.homedir(), "Downloads"),
  appData: path.join(os.homedir(), ".config"),
  logs: path.join(USER_DATA_DIR, "logs"),
  crashDumps: path.join(USER_DATA_DIR, "crashes"),
  modules: path.join(USER_DATA_DIR, "modules"),
};

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(resolveRepoRoot(), "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const app = {
  ...(appEmitter as unknown as { on: typeof appEmitter.on; emit: typeof appEmitter.emit; once: typeof appEmitter.once; removeAllListeners: typeof appEmitter.removeAllListeners }),
  isReady: () => true,
  whenReady: () => Promise.resolve(),
  getName: () => "Dyad",
  getPath: (name: string) => {
    if (name === "userData" || name === "sessionData") {
      ensureDir(appPaths[name]);
    }
    if (!(name in appPaths)) {
      appPaths[name] = path.join(USER_DATA_DIR, name);
    }
    return appPaths[name];
  },
  setPath: (name: string, value: string) => {
    appPaths[name] = value;
  },
  getVersion: () => readPackageVersion(),
  getLocale: () => "en-US",
  getSystemLocale: () => "en-US",
  quit: () => {
    console.log("[web] app.quit() called — ignoring (web server keeps running)");
  },
  exit: (code = 0) => process.exit(code),
  relaunch: () => {
    console.log("[web] app.relaunch() — ignoring");
  },
  requestSingleInstanceLock: () => true,
  setAsDefaultProtocolClient: () => true,
  removeAsDefaultProtocolClient: () => true,
  isDefaultProtocolClient: () => false,
  setAppUserModelId: () => {},
  setUserTasks: () => {},
  allowRendererProcessReuse: () => {},
  disableHardwareAcceleration: () => {},
  commandLine: {
    appendSwitch: () => {},
    appendArgument: () => {},
    hasSwitch: () => false,
  },
  addRecentDocument: () => {},
  clearRecentDocuments: () => {},
  getJumpListSettings: () => ({ minItems: 0, removedItems: [] }),
  setJumpList: () => {},
  getFileIcon: async () => ({ toDataURL: () => "" }),
  badgeCount: 0,
  setBadgeCount: () => false,
  mousedown: () => {},
} as unknown as import("electron").App;

// ---------------------------------------------------------------------------
// safeStorage — deterministic AES-256-GCM under a persisted server key
// ---------------------------------------------------------------------------

function getStorageKey(): Buffer {
  const keyPath = path.join(USER_DATA_DIR, "safe-storage.key");
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === 32) return existing;
  } catch {
    /* create below */
  }
  const key = crypto.randomBytes(32);
  ensureDir(USER_DATA_DIR);
  fs.writeFileSync(keyPath, key);
  return key;
}

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(plain: string): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getStorageKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]);
  },
  decryptString(encrypted: Buffer): string {
    try {
      const iv = encrypted.subarray(0, 12);
      const tag = encrypted.subarray(12, 28);
      const data = encrypted.subarray(28);
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        getStorageKey(),
        iv,
      );
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return "";
    }
  },
  getSelectedStorageBackend: () => "basic_text" as const,
  on: () => {},
} as unknown as import("electron").SafeStorage;

// ---------------------------------------------------------------------------
// nativeTheme — always dark in web mode
// ---------------------------------------------------------------------------

export const nativeTheme = {
  shouldUseDarkColors: true,
  themeSource: "dark" as const,
  getShouldUseDarkColors: () => true,
  getSystemColor: () => ({ hex: "#18181b" }),
  on: () => {},
  off: () => {},
  once: () => {},
  removeAllListeners: () => {},
} as unknown as import("electron").NativeTheme;

// ---------------------------------------------------------------------------
// dialog / shell / clipboard — safe no-ops
// ---------------------------------------------------------------------------

function logNoop(what: string, detail?: unknown): void {
  console.log(`[web] dialog.${what}(${detail ? JSON.stringify(detail)?.slice(0, 200) : ""}) — no-op`);
}

export const dialog = {
  showErrorBox: (title: string, content: string) =>
    logNoop("showErrorBox", `${title}: ${content}`),
  showMessageBox: async (opts: unknown) => {
    logNoop("showMessageBox", opts);
    return { response: 0, checkboxChecked: false, backdrop: "normal" };
  },
  showMessageBoxSync: () => 0,
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showOpenDialogSync: () => [] as string[],
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showCertificateTrustDialog: async () => {},
} as unknown as import("electron").Dialog;

export const shell = {
  openExternal: async (url: string) => {
    console.log(`[web] shell.openExternal(${url}) — no-op`);
  },
  openPath: async (p: string) => {
    console.log(`[web] shell.openPath(${p}) — no-op`);
    return "";
  },
  showItemInFolder: (p: string) =>
    console.log(`[web] shell.showItemInFolder(${p}) — no-op`),
  showInFolder: (p: string) =>
    console.log(`[web] shell.showInFolder(${p}) — no-op`),
  trashItem: async () => true,
  beep: () => {},
  writeShortcutLink: () => false,
  readShortcutLink: () => {
    throw new Error("not supported");
  },
} as unknown as import("electron").Shell;

export const clipboard = {
  readText: () => "",
  writeText: () => {},
  readHTML: () => "",
  writeHTML: () => {},
  readImage: () => ({ toDataURL: () => "", getSize: () => ({ width: 0, height: 0 }) }),
  writeImage: () => {},
  clear: () => {},
  has: () => false,
} as unknown as import("electron").Clipboard;

// ---------------------------------------------------------------------------
// net — thin wrapper over Node fetch (used by managed_node downloads)
// ---------------------------------------------------------------------------

class NetRequestShim {
  private abortController = new AbortController();
  private responsePromise: Promise<Response> | null = null;
  private dataHandlers: ((chunk: Buffer) => void)[] = [];
  private endHandlers: (() => void)[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];
  private headers: Record<string, string> = {};
  private method = "GET";

  constructor(private url: string) {}

  on(event: string, handler: (...args: unknown[]) => void): this {
    if (event === "data") this.dataHandlers.push(handler as (chunk: Buffer) => void);
    if (event === "end") this.endHandlers.push(handler as () => void);
    if (event === "error") this.errorHandlers.push(handler as (err: Error) => void);
    if (event === "response") {
      // managed_node only uses data/end/error; response is optional.
    }
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  setMethod(method: string): this {
    this.method = method;
    return this;
  }

  end(): void {
    this.responsePromise = fetch(this.url, {
      method: this.method,
      headers: this.headers,
      signal: this.abortController.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        throw new Error(`net request failed: ${res.status} for ${this.url}`);
      }
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          for (const h of this.dataHandlers) h(chunk);
        }
      } finally {
        for (const h of this.endHandlers) h();
      }
      return res;
    });
    this.responsePromise.catch((err) => {
      for (const h of this.errorHandlers) h(err);
    });
  }

  abortRequest(): void {
    this.abortController.abort();
  }
}

export const net = {
  request: (url: string) => new NetRequestShim(url),
  isOnline: () => true,
  Session: class {},
} as unknown as import("electron").Net;

// ---------------------------------------------------------------------------
// session — browser-session stubs (spellcheck, storage clearing)
// ---------------------------------------------------------------------------

const sessionStub = {
  setSpellCheckerEnabled: () => {},
  clearStorageData: async () => {},
  clearCache: async () => {},
  clearHostResolverCache: async () => {},
  setUserAgent: () => {},
  setPermissionRequestHandler: () => {},
  setPermissionCheckHandler: () => {},
  setProxy: async () => {},
  protocol: {
    registerStringProtocol: () => {},
    handle: () => {},
    unhandle: () => {},
  },
  cookies: {
    get: async () => [],
    set: async () => {},
    remove: async () => {},
  },
  webRequest: {
    onBeforeRequest: () => {},
    onHeadersReceived: () => {},
  },
  setDownloadPath: () => {},
};

export const session = {
  defaultSession: sessionStub,
  fromPartition: () => sessionStub,
} as unknown as import("electron").Session;

// ---------------------------------------------------------------------------
// utilityProcess — not available; features degrade gracefully
// ---------------------------------------------------------------------------

export const utilityProcess = {
  fork: (() => {
    throw new Error(
      "[web] utilityProcess.fork() is not supported in web mode (code explorer disabled)",
    );
  }) as (path: string) => unknown,
  canRemoteDebug: () => false,
} as unknown as import("electron").UtilityProcess;

// ---------------------------------------------------------------------------
// Misc small surfaces
// ---------------------------------------------------------------------------

export const screen = {
  getPrimaryDisplay: () => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 0, width: 1440, height: 900 },
    scaleFactor: 1,
    rotation: 0,
    touchSupport: "unknown",
  }),
  getAllDisplays: () => [],
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  on: () => {},
} as unknown as import("electron").Screen;

export const Menu = {
  buildFromTemplate: () => ({ popup: () => {}, closePopup: () => {} }),
  setApplicationMenu: () => {},
  getApplicationMenu: () => null,
  sendActionToFirstResponder: () => {},
  popup: () => {},
} as unknown as import("electron").Menu;

export const Tray = class {
  constructor() {}
  setToolTip() {}
  setContextMenu() {}
  on() { return this; }
  destroy() {}
} as unknown as import("electron").Tray;

export const nativeImage = {
  createFromPath: () => ({ toDataURL: () => "", getSize: () => ({ width: 0, height: 0 }) }),
  createFromDataURL: () => ({ toPNG: () => Buffer.alloc(0), getSize: () => ({ width: 0, height: 0 }) }),
  createEmpty: () => ({ toPNG: () => Buffer.alloc(0), isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }),
} as unknown as import("electron").NativeImage;

export const globalShortcut = {
  register: () => {},
  unregister: () => {},
  unregisterAll: () => {},
  isRegistered: () => false,
} as unknown as import("electron").GlobalShortcut;

export const systemPreferences = {
  isDarkMode: () => true,
  getUserDefault: () => "",
  setUserDefault: () => {},
  on: () => {},
  subscribeNotification: () => () => {},
} as unknown as import("electron").SystemPreferences;

export const crashReporter = {
  start: () => {},
  getCrashesDirectory: () => path.join(USER_DATA_DIR, "crashes"),
} as unknown as import("electron").CrashReporter;

export const contentTracing = {
  start: async () => {},
  stop: async () => "",
  getCategories: async () => [] as string[],
} as unknown as import("electron").ContentTracing;

export const powerMonitor = {
  on: () => {},
  getSystemIdleTime: () => 0,
} as unknown as import("electron").PowerMonitor;

export const WebContentsView = class {
  constructor() {}
  setBounds() {}
  webContents = new WebContentsShim("about:blank");
} as unknown as import("electron").WebContentsView;

// preload-only helpers (unused on the server, present for completeness)
export const contextBridge = {
  exposeInMainWorld: () => {},
};
export const ipcRenderer = {
  invoke: () => Promise.resolve(undefined),
  send: () => {},
  on: () => {},
  removeAllListeners: () => {},
  removeListener: () => {},
};
export const webFrame = {
  setZoomFactor: () => {},
  getZoomFactor: () => 1,
};
export const webFrameMain = {
  fromId: () => null,
};

export const protocol = {
  registerStringProtocol: () => {},
  registerFileProtocol: () => {},
  registerBufferProtocol: () => {},
  registerHttpProtocol: () => {},
  handle: () => {},
  unhandle: () => {},
  registerSchemesAsPrivileged: () => {},
};

export const inAppPurchase = {
  canMakePayments: () => false,
};

export const electron = { app };
export default electron;

// ESM interop — the backend is bundled to CJS; `import electron from
// "electron"` should still work if the bundler keeps a default import.
export const __esModule = true;
