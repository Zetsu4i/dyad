// MCP (Model Context Protocol) connection manager.
// Supports stdio / SSE / streamable-HTTP transports via @modelcontextprotocol/sdk.
// One-click install templates make popular integrations easy to configure.
import { getMcpState, saveMcpState, uid } from "./store.mjs";

export const MCP_TEMPLATES = [
  {
    templateId: "github",
    name: "GitHub",
    description: "Repos, issues, PRs, code search.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    url: "",
  },
  {
    templateId: "postgres",
    name: "PostgreSQL",
    description: "Query any Postgres database.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envKeys: [],
    configNote: "Append your connection string as an argument.",
    url: "",
  },
  {
    templateId: "filesystem",
    name: "Filesystem",
    description: "Read/write a local directory tree.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    envKeys: [],
    url: "",
  },
  {
    templateId: "puppeteer",
    name: "Puppeteer (Browser)",
    description: "Control a headless browser.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    envKeys: [],
    url: "",
  },
  {
    templateId: "brave-search",
    name: "Brave Search",
    description: "Web search results.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envKeys: ["BRAVE_API_KEY"],
    url: "",
  },
  {
    templateId: "slack",
    name: "Slack",
    description: "Channels, messages, threads.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envKeys: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    url: "",
  },
  {
    templateId: "stripe",
    name: "Stripe",
    description: "Payments, customers, invoices.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@stripe/mcp", "--tools=all"],
    envKeys: ["STRIPE_SECRET_KEY"],
    url: "",
  },
  {
    templateId: "notion",
    name: "Notion",
    description: "Pages, databases, notes.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    envKeys: ["NOTION_TOKEN"],
    url: "",
  },
  {
    templateId: "custom-sse",
    name: "Custom SSE Server",
    description: "Connect any remote SSE MCP server.",
    transport: "sse",
    command: "",
    args: [],
    envKeys: [],
    url: "https://example.com/sse",
  },
  {
    templateId: "custom-http",
    name: "Custom HTTP Server",
    description: "Connect any streamable-HTTP MCP server.",
    transport: "http",
    command: "",
    args: [],
    envKeys: [],
    url: "https://example.com/mcp",
  },
];

// ---- CRUD ----
export function listServers() {
  return getMcpState().servers;
}

export function createServer(input) {
  const state = getMcpState();
  const server = {
    id: uid("mcp"),
    name: input.name?.trim() || "Untitled MCP",
    transport: input.transport || "stdio",
    command: input.command || "",
    args: Array.isArray(input.args) ? input.args : [],
    env: input.env || {},
    url: input.url || "",
    headers: input.headers || {},
    enabled: input.enabled !== false,
    templateId: input.templateId || null,
    createdAt: new Date().toISOString(),
  };
  state.servers.unshift(server);
  saveMcpState(state);
  return server;
}

export function installTemplate(templateId, overrides = {}) {
  const t = MCP_TEMPLATES.find((x) => x.templateId === templateId);
  if (!t) throw new Error(`Unknown template: ${templateId}`);
  const env = {};
  for (const k of t.envKeys || []) env[k] = "";
  return createServer({
    name: overrides.name || t.name,
    transport: t.transport,
    command: t.command,
    args: [...(t.args || [])],
    env: { ...env, ...(overrides.env || {}) },
    url: overrides.url ?? t.url ?? "",
    headers: overrides.headers || {},
    templateId,
    enabled: overrides.enabled !== false,
  });
}

export function updateServer(id, patch) {
  const state = getMcpState();
  state.servers = state.servers.map((s) =>
    s.id === id ? { ...s, ...patch, id } : s,
  );
  saveMcpState(state);
  disconnect(id); // force reconnect on next use
  return state.servers.find((s) => s.id === id) || null;
}

export function deleteServer(id) {
  disconnect(id);
  const state = getMcpState();
  state.servers = state.servers.filter((s) => s.id !== id);
  saveMcpState(state);
}

// ---- live clients ----
const clients = new Map(); // id -> { client, transport, tools, status, error }
const statusMap = new Map(); // id -> { status, error, toolCount }

export function getStatuses() {
  const out = {};
  for (const s of listServers()) {
    out[s.id] = statusMap.get(s.id) || { status: "disconnected", error: null };
  }
  return out;
}

async function buildTransport(server) {
  if (server.transport === "stdio") {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    return new StdioClientTransport({
      command: server.command,
      args: server.args || [],
      env: { ...process.env, ...(server.env || {}) },
      stderr: "pipe",
    });
  }
  if (server.transport === "sse") {
    const { SSEClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/sse.js"
    );
    return new SSEClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers || {} },
    });
  }
  // streamable http
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: server.headers || {} },
  });
}

export async function connect(id) {
  const server = listServers().find((s) => s.id === id);
  if (!server) throw new Error("MCP server not found");
  if (clients.has(id)) return clients.get(id);

  statusMap.set(id, { status: "connecting", error: null });
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const transport = await buildTransport(server);
    const client = new Client(
      { name: "dyad-saas", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
    const toolsRes = await client.listTools().catch(() => ({ tools: [] }));
    const tools = (toolsRes.tools || []).map((t) => ({
      name: `mcp__${id}__${t.name}`,
      originServer: id,
      originServerName: server.name,
      originTool: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    }));
    const entry = { client, transport, tools };
    clients.set(id, entry);
    statusMap.set(id, { status: "connected", error: null, toolCount: tools.length });
    return entry;
  } catch (err) {
    statusMap.set(id, { status: "error", error: String(err?.message || err) });
    throw err;
  }
}

export async function disconnect(id) {
  const entry = clients.get(id);
  clients.delete(id);
  if (entry) {
    try {
      await entry.client.close();
    } catch {}
  }
  const cur = statusMap.get(id);
  if (cur && cur.status === "connected") {
    statusMap.set(id, { status: "disconnected", error: null });
  }
}

export async function ensureConnected(id) {
  if (clients.has(id)) return clients.get(id);
  return connect(id);
}

export async function listToolsFor(id) {
  const entry = await ensureConnected(id);
  return entry.tools;
}

export async function callTool(id, toolName, args) {
  const entry = await ensureConnected(id);
  // strip prefix if present
  const bare = toolName.startsWith(`mcp__${id}__`)
    ? toolName.slice(`mcp__${id}__`.length)
    : toolName;
  const res = await entry.client.callTool({ name: bare, arguments: args || {} });
  return res;
}

// Aggregate tools from all enabled servers (best-effort; failures recorded).
export async function aggregateTools() {
  const tools = [];
  for (const s of listServers().filter((x) => x.enabled)) {
    try {
      const t = await listToolsFor(s.id);
      tools.push(...t);
    } catch (err) {
      // status already recorded; skip
    }
  }
  return tools;
}
