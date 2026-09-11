// ============================================================================
// MCP server catalog — one-click installable third-party integrations.
// stdio servers run inside the app's sandbox via the embedded MCP bridge.
// ============================================================================

export interface CatalogMcpServer {
  catalogId: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** Env/header keys the user must fill in before the server works. */
  requiredEnvKeys?: { key: string; label: string; optional?: boolean }[];
  category: string;
  /** Rough risk hint surfaced in the consent policy. */
  readonly_hint?: boolean;
}

export const MCP_CATALOG: CatalogMcpServer[] = [
  {
    catalogId: "everything",
    name: "Everything (reference)",
    description:
      "Official MCP reference server: echo, add, print, and other demo tools. Great for verifying the MCP pipeline works.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    category: "Developer tools",
  },
  {
    catalogId: "filesystem",
    name: "Filesystem",
    description:
      "Read, search and write files inside the app sandbox workspace (scoped to the project directory).",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/app"],
    category: "Developer tools",
    readonly_hint: false,
  },
  {
    catalogId: "memory",
    name: "Memory",
    description:
      "Persistent knowledge-graph memory the agent can read/write across the session (entities, relations, observations).",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: { MEMORY_FILE_PATH: "/home/user/.dyad/memory.json" },
    category: "Productivity",
  },
  {
    catalogId: "sequential-thinking",
    name: "Sequential Thinking",
    description:
      "Structured step-by-step reasoning tool the agent can use to plan complex tasks and revise them dynamically.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    category: "Productivity",
    readonly_hint: true,
  },
  {
    catalogId: "github",
    name: "GitHub",
    description:
      "Create issues, read repos, manage branches and PRs through the official GitHub MCP server.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiredEnvKeys: [
      { key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub personal access token" },
    ],
    category: "Developer tools",
  },
  {
    catalogId: "brave-search",
    name: "Brave Search",
    description: "Web and local search via the Brave Search API.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    requiredEnvKeys: [{ key: "BRAVE_API_KEY", label: "Brave Search API key" }],
    category: "Web & search",
    readonly_hint: true,
  },
  {
    catalogId: "fetch",
    name: "Fetch",
    description: "Fetch and convert web pages to markdown for the agent to read.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    category: "Web & search",
    readonly_hint: true,
  },
  {
    catalogId: "puppeteer",
    name: "Puppeteer",
    description: "Drive a headless browser: navigate, click, screenshot pages from inside the sandbox.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    category: "Web & search",
    readonly_hint: true,
  },
  {
    catalogId: "postgres",
    name: "PostgreSQL",
    description: "Read-only SQL access to a Postgres database (schema inspection + SELECT queries).",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "$DATABASE_URL"],
    requiredEnvKeys: [
      { key: "DATABASE_URL", label: "Postgres connection string" },
    ],
    category: "Data",
    readonly_hint: true,
  },
  {
    catalogId: "slack",
    name: "Slack",
    description: "List channels and send messages to a Slack workspace.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    requiredEnvKeys: [
      { key: "SLACK_BOT_TOKEN", label: "Slack bot token (xoxb-...)" },
      { key: "SLACK_TEAM_ID", label: "Slack team ID" },
    ],
    category: "Communication",
  },
  {
    catalogId: "exa",
    name: "Exa",
    description: "AI-powered web search that returns clean, relevant results and content.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "exa-mcp-server"],
    requiredEnvKeys: [{ key: "EXA_API_KEY", label: "Exa API key" }],
    category: "Web & search",
    readonly_hint: true,
  },
  {
    catalogId: "notion",
    name: "Notion (hosted)",
    description:
      "Connect to Notion's hosted MCP endpoint. Requires a Notion integration token or OAuth setup.",
    transport: "http",
    url: "https://mcp.notion.com/mcp",
    category: "Productivity",
    readonly_hint: false,
  },
  {
    catalogId: "linear",
    name: "Linear (hosted)",
    description: "Read and manage Linear issues, projects and cycles via Linear's hosted MCP endpoint.",
    transport: "http",
    url: "https://mcp.linear.app/sse",
    category: "Productivity",
    readonly_hint: false,
  },
];

export function getCatalogEntry(catalogId: string) {
  return MCP_CATALOG.find((c) => c.catalogId === catalogId);
}
