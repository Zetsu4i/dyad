// ============================================================================
// MCP Bridge — runs INSIDE the sandbox (no dependencies, plain Node >= 18).
//
// Reads /opt/dyad/mcp-config.json:
//   { "token": "...", "servers": [{ "id", "name", "transport": "stdio"|"http",
//       "command", "args", "env", "url", "headers" }] }
//
// Spawns each MCP server, performs the JSON-RPC handshake, aggregates tools,
// and exposes a small HTTP API on 0.0.0.0:3777 secured by a bearer token:
//   GET  /health
//   GET  /tools                 -> [{ server, serverName, name, description, inputSchema }]
//   POST /call                  { server, tool, args } -> MCP tool result
//   POST /refresh               -> restart all servers, re-list tools
// ============================================================================
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BRIDGE_BASE_DIR || "/home/user/.dyad";
const CONFIG_PATH = `${BASE}/mcp-config.json`;
const LOG_PATH = `${BASE}/mcp-bridge.log`;
const PORT = Number(process.env.BRIDGE_PORT || 3777);
const PROTOCOL_VERSION = "2024-11-05";

let TOKEN = "";
/** serverId -> session */
const sessions = new Map();

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  process.stderr.write(line);
}

class StdioMcpSession {
  constructor(def) {
    this.def = def;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.tools = [];
    this.ready = false;
    this.error = null;
  }

  async start() {
    const def = this.def;
    log(`starting stdio server ${def.id}: ${def.command} ${JSON.stringify(def.args || [])}`);
    this.proc = spawn(def.command, def.args || [], {
      env: { ...process.env, ...(def.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString().slice(0, 2000);
      log(`[${def.id} stderr] ${text.trim().split("\n").slice(0, 4).join(" | ")}`);
    });
    this.proc.on("exit", (code) => {
      log(`server ${def.id} exited with code ${code}`);
      this.ready = false;
      this.error = `process exited (code ${code})`;
      for (const p of this.pending.values()) p.reject(new Error(this.error));
      this.pending.clear();
    });
    try {
      await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "dyad-cloud-bridge", version: "1.0.0" },
      }, 60_000);
      this.notify("notifications/initialized", {});
      const res = await this.request("tools/list", {}, 60_000);
      this.tools = (res && res.tools) || [];
      this.ready = true;
      this.error = null;
      log(`server ${def.id} ready with ${this.tools.length} tools`);
    } catch (e) {
      this.error = e.message;
      log(`server ${def.id} failed: ${e.message}`);
      throw e;
    }
  }

  _onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }
  }

  send(msg) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error("server process not running");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try { this.send(msg); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  async callTool(name, args) {
    if (!this.ready) throw new Error(this.error || "server not ready");
    return this.request("tools/call", { name, arguments: args || {} }, 120_000);
  }

  kill() {
    try { this.proc && this.proc.kill("SIGKILL"); } catch {}
  }
}

class HttpMcpSession {
  constructor(def) {
    this.def = def;
    this.tools = [];
    this.ready = false;
    this.error = null;
    this.sessionId = null;
    this.nextId = 1;
  }

  async rpc(method, params, isNotification = false) {
    const body = { jsonrpc: "2.0", method, params };
    if (!isNotification) body.id = this.nextId++;
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.def.headers || {}),
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await fetch(this.def.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(isNotification ? 10_000 : 60_000),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (isNotification) return null;
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    // Response may be plain JSON or an SSE stream.
    if (text.startsWith("event:") || text.startsWith("data:")) {
      const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
      for (const l of dataLines) {
        try {
          const msg = JSON.parse(l.slice(5).trim());
          if (msg.error) throw new Error(msg.error.message || "MCP error");
          if (msg.result !== undefined) return msg.result;
        } catch (e) {
          if (e.message && !e.message.includes("JSON")) throw e;
        }
      }
      throw new Error("no JSON-RPC result in SSE response");
    }
    const msg = JSON.parse(text);
    if (msg.error) throw new Error(msg.error.message || "MCP error");
    return msg.result;
  }

  async start() {
    try {
      await this.rpc("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "dyad-cloud-bridge", version: "1.0.0" },
      });
      await this.rpc("notifications/initialized", {}, true).catch(() => {});
      const res = await this.rpc("tools/list", {});
      this.tools = (res && res.tools) || [];
      this.ready = true;
      this.error = null;
      log(`http server ${this.def.id} ready with ${this.tools.length} tools`);
    } catch (e) {
      this.error = e.message;
      log(`http server ${this.def.id} failed: ${e.message}`);
      throw e;
    }
  }

  async callTool(name, args) {
    if (!this.ready) throw new Error(this.error || "server not ready");
    return this.rpc("tools/call", { name, arguments: args || {} });
  }

  kill() { /* nothing to kill for remote servers */ }
}

async function startAll() {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  TOKEN = cfg.token || "";
  for (const def of cfg.servers || []) {
    const session = def.transport === "http" ? new HttpMcpSession(def) : new StdioMcpSession(def);
    sessions.set(def.id, session);
    // Start each server; failures are isolated so one broken MCP server
    // doesn't take down the rest.
    session.start().catch(() => {});
  }
  // Give servers a moment to boot before the first tools listing.
  await new Promise((r) => setTimeout(r, 2500));
}

function allTools() {
  const out = [];
  for (const [id, s] of sessions) {
    for (const t of s.tools || []) {
      out.push({
        server: id,
        serverName: s.def.name || id,
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || { type: "object", properties: {} },
      });
    }
  }
  return out;
}

function extractText(result) {
  if (!result) return "(empty result)";
  if (typeof result === "string") return result;
  if (result.content) {
    return result.content
      .map((c) => {
        if (c.type === "text") return c.text;
        if (c.type === "image") return `[image: ${c.mimeType || "unknown"}]`;
        if (c.type === "resource") {
          const r = c.resource || {};
          return r.text ? r.text : `[resource: ${r.uri || "unknown"}]`;
        }
        return JSON.stringify(c);
      })
      .join("\n");
  }
  return JSON.stringify(result).slice(0, 20_000);
}

const server = http.createServer(async (req, res) => {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  const sendJson = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "content-type": "application/json" });
    res.end(body);
  };
  try {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      const ready = [...sessions.values()].filter((s) => s.ready).length;
      sendJson(200, { ok: true, servers: sessions.size, ready });
      return;
    }
    if (req.method === "GET" && req.url === "/tools") {
      sendJson(200, { tools: allTools() });
      return;
    }
    if (req.method === "POST" && req.url === "/refresh") {
      await startAll();
      sendJson(200, { tools: allTools() });
      return;
    }
    if (req.method === "POST" && req.url === "/call") {
      let raw = "";
      for await (const c of req) raw += c;
      const { server: serverId, tool, args } = JSON.parse(raw || "{}");
      const s = sessions.get(serverId);
      if (!s) return sendJson(404, { error: `unknown server ${serverId}` });
      if (!s.ready) {
        // Try once more before failing — npx cold-start can be slow.
        try { await s.start(); } catch (e) {
          return sendJson(502, { error: `server not ready: ${s.error || e.message}` });
        }
      }
      const result = await s.callTool(tool, args);
      sendJson(200, { result, text: extractText(result), isError: !!result?.isError });
      return;
    }
    sendJson(404, { error: "not found" });
  } catch (e) {
    sendJson(500, { error: e.message || String(e) });
  }
});

startAll()
  .then(() => log("bridge started"))
  .catch((e) => log(`bridge start error: ${e.message}`));

server.listen(PORT, "0.0.0.0", () => log(`listening on ${PORT}`));
