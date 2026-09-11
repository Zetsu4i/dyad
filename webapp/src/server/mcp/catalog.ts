/**
 * Curated MCP server catalog — one-click install presets for popular
 * third-party services. Remote (HTTP/SSE) servers work on any deployment;
 * stdio presets run as local processes and are meant for self-hosted setups.
 */

export interface CatalogEntry {
  name: string;
  description: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  scope: "global";
  docsUrl?: string;
}

export const MCP_CATALOG: CatalogEntry[] = [
  {
    name: "DeepWiki",
    description:
      "Ask questions about any open-source repository and get grounded answers with citations.",
    transport: "http",
    url: "https://mcp.deepwiki.com/mcp",
    scope: "global",
    docsUrl: "https://deepwiki.com",
  },
  {
    name: "Context7",
    description:
      "Up-to-date documentation for thousands of libraries, injected straight into the agent's context.",
    transport: "http",
    url: "https://mcp.context7.com/mcp",
    scope: "global",
    docsUrl: "https://context7.com",
  },
  {
    name: "GitHub (Copilot MCP)",
    description:
      "Repositories, issues, pull requests and more via GitHub's official remote MCP endpoint. Requires your GitHub token in headers.",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    scope: "global",
    docsUrl: "https://github.com/github/github-mcp-server",
  },
  {
    name: "Sentry",
    description:
      "Query errors, stack traces and releases from your Sentry organization. Requires a Sentry OAuth app or token.",
    transport: "sse",
    url: "https://mcp.sentry.dev/sse",
    scope: "global",
    docsUrl: "https://docs.sentry.io/product/explore/mcp-server/",
  },
  {
    name: "Fetch (stdio)",
    description:
      "Let the agent fetch and read web pages. Runs as a local process — recommended for self-hosted deployments.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-fetch"],
    scope: "global",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    name: "Filesystem (stdio)",
    description:
      "Read/write access to a directory on the server. Runs as a local process — recommended for self-hosted deployments.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    scope: "global",
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "Memory (stdio)",
    description:
      "Persistent knowledge graph the agent can read and write across chats.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    scope: "global",
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "Postgres (stdio)",
    description:
      "Read-only SQL access to a PostgreSQL database. Set DATABASE_URL in the env fields.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    env: { DATABASE_URL: "" },
    scope: "global",
    docsUrl: "https://github.com/modelcontextprotocol/servers",
  },
];
