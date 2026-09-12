// MCP manager — runs user-configured MCP servers inside the app's E2B sandbox
// (stdio servers are bridged to HTTP with supergateway) and connects a real
// MCP client from the Next.js server so the agent can call tools live.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Sandbox } from "e2b";
import { db } from "@/lib/db";
import type { RunningSandbox } from "@/lib/e2b/sandbox";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpBridge {
  serverId: string;
  serverName: string;
  port: number;
  client: Client | null;
  tools: McpToolInfo[];
  status: "connected" | "error" | "starting";
  error?: string;
  startedAt?: number;
}

const MCP_BASE_PORT = 8100;

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function mcpToolKey(serverName: string, toolName: string): string {
  return `mcp_${sanitizeName(serverName)}_${sanitizeName(toolName)}`;
}

function buildGatewayCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  port: number
): string {
  const stdioCmd = [command, ...args]
    .map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a))
    .join(" ");
  const envPrefix = Object.entries(env)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  const parts = [
    envPrefix,
    "npx -y supergateway",
    `--stdio ${JSON.stringify(stdioCmd)}`,
    `--outputTransport streamableHttp`,
    `--port ${port}`,
  ].filter(Boolean);
  return parts.join(" ");
}

export function parseMcpKey(key: string): { server: string; tool: string } | null {
  const m = key.match(/^mcp_([a-z0-9_]+)_([a-z0-9_]+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2] };
}

// ---------------------------------------------------------------------------
// Bridge lifecycle per running sandbox
// ---------------------------------------------------------------------------

export async function startMcpBridges(entry: RunningSandbox): Promise<void> {
  const appMcps = await db.appMcp.findMany({
    where: { appId: entry.appId, enabled: true, mcpServer: { enabled: true } },
    include: { mcpServer: true },
  });
  for (const { mcpServer } of appMcps) {
    // Idempotent: skip bridges already connected or starting recently —
    // concurrent starts kill each other's gateway processes.
    const existing = entry.mcp.get(mcpServer.id);
    if (
      existing &&
      (existing.status === "connected" ||
        (existing.status === "starting" && Date.now() - (existing.startedAt ?? 0) < 120_000))
    ) {
      continue;
    }
    await startMcpBridge(entry, mcpServer.id).catch((err) => {
      console.warn(`[mcp] bridge failed for ${mcpServer.name}:`, err);
    });
  }
}

export async function startMcpBridge(
  entry: RunningSandbox,
  serverId: string
): Promise<McpBridge> {
  const server = await db.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) throw new Error("MCP server not found");

  // Stop any existing bridge for this server
  await stopMcpBridge(entry, serverId);

  const port = server.port || MCP_BASE_PORT + (entry.mcp.size % 40);
  const args: string[] = safeParseArray(server.args);
  const env: Record<string, string> = safeParseRecord(server.env);
  const cmd = buildGatewayCommand(server.command, args, env, port);

  const bridge: McpBridge = {
    serverId: server.id,
    serverName: server.name,
    port,
      client: null,
    tools: [],
    status: "starting",
  };
  entry.mcp.set(serverId, bridge);

  // 1) Launch supergateway inside the sandbox — fully detached so it survives
  //    SDK stream disconnects (same pattern as the dev server).
  const detachedCmd = `setsid nohup ${cmd} > /tmp/mcp-${port}.log 2>&1 < /dev/null & echo gateway-started`;
  console.log(`[mcp] starting gateway for ${server.name} on port ${port}`);
  await entry.sandbox.commands.run(detachedCmd, {
    cwd: "/home/user",
    timeoutMs: 30_000,
  }).catch((e) => console.warn(`[mcp] gateway start failed for ${server.name}:`, e));
  console.log(`[mcp] gateway started for ${server.name}`);

  // 2) Wait for the gateway to come up, then connect the MCP client
  const host = entry.sandbox.getHost(port);
  const url = `https://${host}/mcp`;
  const client = new Client({ name: `forge-${sanitizeName(server.name)}`, version: "1.0.0" });

  let connected = false;
  let lastErr: unknown = null;
  // head start for supergateway (npx download), then bounded retries
  console.log(`[mcp] waiting head start for ${server.name}`);
  await sleep(10_000);
  for (let attempt = 0; attempt < 5; attempt++) {
    console.log(`[mcp] connect attempt ${attempt + 1} for ${server.name}`);
    try {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await withTimeout(client.connect(transport), 15_000);
      connected = true;
      break;
    } catch (err) {
      lastErr = err;
      await sleep(5_000);
    }
  }
  if (!connected) {
    // fallback: SSE transport
    try {
      const sseTransport = new SSEClientTransport(new URL(`https://${host}/sse`));
      await withTimeout(client.connect(sseTransport), 15_000);
      connected = true;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!connected) {
    bridge.status = "error";
    bridge.error = lastErr instanceof Error ? lastErr.message : String(lastErr);
    await entry.sandbox.commands
      .run(`pkill -f 'supergateway.*--port ${port}' ; true`, { timeoutMs: 8000 })
      .catch(() => {});
    await db.mcpServer.update({
      where: { id: server.id },
      data: { status: "error", statusMessage: bridge.error?.slice(0, 500) },
    });
    return bridge;
  }

  bridge.client = client;
  console.log(`[mcp] connected! listing tools for ${server.name}`);
  try {
    const res = await withTimeout(client.listTools(), 20_000);
    bridge.tools = (res.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? undefined,
      inputSchema: t.inputSchema,
    }));
    bridge.status = "connected";
    await db.mcpServer.update({
      where: { id: server.id },
      data: {
        status: "connected",
        statusMessage: null,
        toolsJson: JSON.stringify(bridge.tools),
        port,
      },
    });
  } catch (err) {
    bridge.status = "error";
    bridge.error = err instanceof Error ? err.message : String(err);
    await db.mcpServer.update({
      where: { id: server.id },
      data: { status: "error", statusMessage: bridge.error?.slice(0, 500) },
    });
  }
  return bridge;
}

export async function stopMcpBridge(entry: RunningSandbox, serverId: string) {
  const bridge = entry.mcp.get(serverId);
  if (!bridge) return;
  try { await bridge.client?.close(); } catch {}
  try {
    await entry.sandbox.commands.run(`pkill -f 'supergateway.*--port ${bridge.port}' ; true`, { timeoutMs: 8000 }).catch(() => {});
  } catch {}
  entry.mcp.delete(serverId);
}

export async function stopMcpBridges(entry: RunningSandbox) {
  for (const serverId of [...entry.mcp.keys()]) {
    await stopMcpBridge(entry, serverId);
  }
}

export async function callMcpTool(
  entry: RunningSandbox,
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const bridge = entry.mcp.get(serverId);
  if (!bridge || !bridge.client) throw new Error(`MCP server not connected: ${serverId}`);
  const res = await bridge.client.callTool({ name: toolName, arguments: args });
  if (res.isError) {
    const text = contentToText(res.content);
    throw new Error(text || "MCP tool call failed");
  }
  return res;
}

export function contentToText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "object" && c !== null && "text" in (c as Record<string, unknown>)) {
          return String((c as Record<string, unknown>).text);
        }
        return JSON.stringify(c);
      })
      .join("\n");
  }
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

export function getBridge(entry: RunningSandbox, serverId: string): McpBridge | undefined {
  return entry.mcp.get(serverId);
}

export function listBridges(entry: RunningSandbox): McpBridge[] {
  return [...entry.mcp.values()];
}

// ---------------------------------------------------------------------------
// Standalone connection test (used by Settings → MCP test button)
// Spins a short-lived sandbox just for the test when the app sandbox isn't running.
// ---------------------------------------------------------------------------

export async function testMcpConnection(
  command: string,
  args: string[],
  env: Record<string, string>,
  opts: { apiKey: string; port?: number }
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  const { Sandbox } = await import("e2b");
  const port = opts.port ?? 8199;
  let sandbox: Sandbox | null = null;
  // Hard watchdog — never let a test hang the route handler.
  const watchdog = sleep(150_000).then(() => {
    throw new Error("Connection test timed out after 150s");
  });
  const run = (async () => {
    sandbox = await Sandbox.create("base", {
      apiKey: opts.apiKey,
      timeoutMs: 5 * 60_000,
    });
    try {
      const cmd = buildGatewayCommand(command, args, env, port);
      await sandbox.commands.run(
        `setsid nohup ${cmd} > /tmp/mcp-test.log 2>&1 < /dev/null & echo started`,
        { cwd: "/tmp", timeoutMs: 30_000 }
      );
      const host = sandbox.getHost(port);
      const client = new Client({ name: "forge-mcp-test", version: "1.0.0" });

      // supergateway (npx) needs time to boot — give it a head start
      await sleep(12_000);
      let connected = false;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const transport = new StreamableHTTPClientTransport(new URL(`https://${host}/mcp`));
          await withTimeout(client.connect(transport), 15_000);
          connected = true;
          break;
        } catch (err) {
          lastErr = err;
          await sleep(5_000);
        }
      }
      if (!connected) {
        try {
          const sse = new SSEClientTransport(new URL(`https://${host}/sse`));
          await withTimeout(client.connect(sse), 15_000);
          connected = true;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!connected) {
        const log = await sandbox.commands
          .run("tail -5 /tmp/mcp-test.log 2>/dev/null || true", { timeoutMs: 6000 })
          .catch(() => null);
        const logText = log?.stdout?.trim() ?? "";
        return {
          ok: false,
          tools: [],
          error: `${lastErr instanceof Error ? lastErr.message : String(lastErr)}${logText ? ` | gateway: ${logText.slice(0, 200)}` : ""}`,
        };
      }
      const res = await withTimeout(client.listTools(), 20_000);
      const tools = (res.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? undefined,
        inputSchema: t.inputSchema,
      }));
      try { await client.close(); } catch {}
      return { ok: true, tools };
    } finally {
      try { await sandbox?.kill(); } catch {}
    }
  })();
  return Promise.race([run, watchdog]);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error(`Timed out after ${ms}ms`);
    }),
  ]) as Promise<T>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeParseArray(s: string): string[] {
  try { return JSON.parse(s || "[]"); } catch { return []; }
}
function safeParseRecord(s: string): Record<string, string> {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}
