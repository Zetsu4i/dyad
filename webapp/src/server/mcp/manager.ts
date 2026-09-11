import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appMcps, mcpServers, type McpServer } from "../db/schema";

/**
 * MCP (Model Context Protocol) manager.
 *
 * Connects to user-configured MCP servers and exposes their tools to the
 * agent. Transports:
 *  - "http"  → Streamable HTTP (recommended remote transport)
 *  - "sse"   → legacy HTTP+SSE remote transport
 *  - "stdio" → local process transport (self-hosted; runs on the server)
 *
 * Tool listings are cached in the DB (tools_cache) so the Settings dashboard
 * can display tools even while a server is offline; the agent always gets a
 * live connection.
 */

interface CachedConnection {
  client: Client;
  connectedAt: number;
}

const connections = new Map<string, CachedConnection>();
const CONN_TTL_MS = 10 * 60_000;

function connKey(server: McpServer): string {
  return `mcp-${server.id}`;
}

export function parseServerConfig(server: McpServer): {
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
} {
  const safeParse = <T>(v: string | null, fallback: T): T => {
    if (!v) return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  };
  return {
    args: safeParse<string[]>(server.args, []),
    env: safeParse<Record<string, string>>(server.env, {}),
    headers: safeParse<Record<string, string>>(server.headers, {}),
  };
}

async function createClient(server: McpServer): Promise<Client> {
  const client = new Client({
    name: "dyad-cloud",
    version: "0.1.0",
  });
  const { headers } = parseServerConfig(server);

  if (server.transport === "stdio") {
    if (!server.command) throw new Error("stdio transport requires a command");
    const { args, env } = parseServerConfig(server);
    const transport = new StdioClientTransport({
      command: server.command,
      args,
      env: { ...process.env, ...env } as Record<string, string>,
    });
    await client.connect(transport);
    return client;
  }

  if (!server.url) throw new Error(`${server.transport} transport requires a URL`);
  if (server.transport === "http") {
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers },
    });
    await client.connect(transport);
    return client;
  }
  // sse
  const transport = new SSEClientTransport(new URL(server.url), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return client;
}

/** Live (or cached) connection. Throws with a friendly message on failure. */
export async function connectServer(server: McpServer): Promise<Client> {
  const key = connKey(server);
  const cached = connections.get(key);
  if (cached && Date.now() - cached.connectedAt < CONN_TTL_MS) {
    return cached.client;
  }
  if (cached) {
    try {
      await cached.client.close();
    } catch {
      /* ignore */
    }
    connections.delete(key);
  }
  const client = await createClient(server);
  connections.set(key, { client, connectedAt: Date.now() });
  return client;
}

export async function disconnectServer(serverId: number) {
  const key = `mcp-${serverId}`;
  const cached = connections.get(key);
  if (cached) {
    try {
      await cached.client.close();
    } catch {
      /* ignore */
    }
    connections.delete(key);
  }
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export async function listTools(server: McpServer): Promise<McpToolInfo[]> {
  const client = await connectServer(server);
  const res = await client.listTools();
  return (res.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

export async function callTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: unknown; isError: boolean }> {
  const client = await connectServer(server);
  const res = await client.callTool({ name: toolName, arguments: args });
  const isError = Boolean((res as { isError?: boolean }).isError);
  return { content: res.content ?? res, isError };
}

/** Test connectivity + refresh the tools cache. Updates lastStatus in DB. */
export async function testConnection(serverId: number): Promise<{
  ok: boolean;
  error?: string;
  tools: McpToolInfo[];
}> {
  const server = db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId))
    .get() as McpServer | undefined;
  if (!server) return { ok: false, error: "Server not found", tools: [] };
  try {
    const tools = await listTools(server);
    db.update(mcpServers)
      .set({ lastStatus: "connected", lastError: null, toolsCache: JSON.stringify(tools) })
      .where(eq(mcpServers.id, serverId))
      .run();
    return { ok: true, tools };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(mcpServers)
      .set({ lastStatus: "error", lastError: message.slice(0, 500) })
      .where(eq(mcpServers.id, serverId))
      .run();
    return { ok: false, error: message, tools: [] };
  }
}

/** Servers enabled for a given app: global enabled servers + app-attached. */
export function serversForApp(appId: number): McpServer[] {
  const all = db.select().from(mcpServers).all() as McpServer[];
  const attached = new Set(
    (
      db
        .select()
        .from(appMcps)
        .where(eq(appMcps.appId, appId))
        .all() as { mcpId: number }[]
    ).map((r) => r.mcpId),
  );
  return all.filter(
    (s) => s.enabled && (s.scope === "global" || attached.has(s.id)),
  );
}

export function cachedTools(server: McpServer): McpToolInfo[] {
  if (!server.toolsCache) return [];
  try {
    return JSON.parse(server.toolsCache) as McpToolInfo[];
  } catch {
    return [];
  }
}
