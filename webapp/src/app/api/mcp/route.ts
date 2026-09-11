import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { mcpServers } from "@/server/db/schema";
import { cachedTools, disconnectServer, testConnection } from "@/server/mcp/manager";
import { MCP_CATALOG } from "@/server/mcp/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/mcp — MCP servers with cached tools + catalog. */
export async function GET() {
  bootstrap();
  const rows = db.select().from(mcpServers).all();
  return Response.json({
    servers: rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      transport: s.transport,
      url: s.url,
      command: s.command,
      args: s.args,
      env: s.env,
      headers: s.headers ? Object.keys(JSON.parse(s.headers || "{}")) : [],
      scope: s.scope,
      enabled: s.enabled,
      fromCatalog: s.fromCatalog,
      lastStatus: s.lastStatus,
      lastError: s.lastError,
      tools: cachedTools(s),
    })),
    catalog: MCP_CATALOG,
  });
}

/**
 * POST /api/mcp — create a server.
 * Body: { name, description?, transport, url?, command?, args?, env?, headers?, scope? }
 * or    { installFromCatalog: "<catalog name>" }
 * `test: true` verifies the connection immediately.
 */
export async function POST(request: Request) {
  bootstrap();
  const body = (await request.json().catch(() => ({}))) as {
    installFromCatalog?: string;
    name?: string;
    description?: string;
    transport?: "http" | "sse" | "stdio";
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    scope?: "global" | "app";
    test?: boolean;
  };

  let spec = body;
  if (body.installFromCatalog) {
    const entry = MCP_CATALOG.find((c) => c.name === body.installFromCatalog);
    if (!entry) return Response.json({ error: "Unknown catalog entry" }, { status: 400 });
    const exists = db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.name, entry.name))
      .get();
    if (exists) {
      return Response.json({ server: exists, existed: true });
    }
    spec = {
      name: entry.name,
      description: entry.description,
      transport: entry.transport,
      url: entry.url,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      scope: "global",
      test: body.test,
    };
  }

  if (!spec.name || !spec.transport) {
    return Response.json({ error: "name and transport are required" }, { status: 400 });
  }
  if (spec.transport !== "stdio" && !spec.url) {
    return Response.json({ error: "url is required for http/sse transports" }, { status: 400 });
  }
  if (spec.transport === "stdio" && !spec.command) {
    return Response.json({ error: "command is required for stdio transport" }, { status: 400 });
  }

  const inserted = db
    .insert(mcpServers)
    .values({
      name: spec.name,
      description: spec.description ?? null,
      transport: spec.transport,
      url: spec.url ?? null,
      command: spec.command ?? null,
      args: spec.args ? JSON.stringify(spec.args) : null,
      env: spec.env && Object.keys(spec.env).length ? JSON.stringify(spec.env) : null,
      headers:
        spec.headers && Object.keys(spec.headers).length
          ? JSON.stringify(spec.headers)
          : null,
      scope: spec.scope ?? "global",
      fromCatalog: Boolean(body.installFromCatalog),
    })
    .returning()
    .get();

  if (body.test) {
    const result = await testConnection(inserted.id);
    return Response.json({ server: inserted, test: result }, { status: 201 });
  }
  return Response.json({ server: inserted }, { status: 201 });
}

/** PATCH /api/mcp?id=1 — update fields / enable / disable. */
export async function PATCH(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    description?: string;
    url?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    scope?: "global" | "app";
  };
  const server = db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
  if (!server) return Response.json({ error: "not found" }, { status: 404 });

  if (
    body.url !== undefined ||
    body.args !== undefined ||
    body.env !== undefined ||
    body.headers !== undefined ||
    body.scope !== undefined
  ) {
    await disconnectServer(id); // config changed → drop cached connection
  }

  db.update(mcpServers)
    .set({
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.url !== undefined ? { url: body.url || null } : {}),
      ...(body.args !== undefined
        ? { args: JSON.stringify(body.args) }
        : {}),
      ...(body.env !== undefined
        ? { env: Object.keys(body.env).length ? JSON.stringify(body.env) : null }
        : {}),
      ...(body.headers !== undefined
        ? {
            headers: Object.keys(body.headers).length
              ? JSON.stringify(body.headers)
              : null,
          }
        : {}),
      ...(body.scope !== undefined ? { scope: body.scope } : {}),
      ...(body.url !== undefined || body.args !== undefined || body.env !== undefined
        ? { lastStatus: "unknown", lastError: null }
        : {}),
    })
    .where(eq(mcpServers.id, id))
    .run();
  return Response.json({ ok: true });
}

/** POST /api/mcp?id=1&op=test|disconnect — live test + refresh tool cache. */
export async function PUT(request: Request) {
  bootstrap();
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  const op = url.searchParams.get("op") ?? "test";
  if (op === "test") {
    const result = await testConnection(id);
    return Response.json(result);
  }
  if (op === "disconnect") {
    await disconnectServer(id);
    db.update(mcpServers)
      .set({ lastStatus: "unknown" })
      .where(eq(mcpServers.id, id))
      .run();
    return Response.json({ ok: true });
  }
  return Response.json({ error: "unknown op" }, { status: 400 });
}

/** DELETE /api/mcp?id=1 */
export async function DELETE(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  await disconnectServer(id);
  db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
  return Response.json({ ok: true });
}
