import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";

export async function GET() {
  return withAuth(async (user) => {
    const servers = await db.mcpServer.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { appMcps: true } } },
    });
    return ok({
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        args: safeParse(s.args, []),
        env: safeParse(s.env, {}),
        enabled: s.enabled,
        status: s.status,
        statusMessage: s.statusMessage,
        port: s.port,
        tools: safeParse(s.toolsJson, []) as { name: string; description?: string }[],
        appCount: s._count.appMcps,
      })),
    });
  });
}

// POST { name, command, args?, env? } — register a new MCP server
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    if (!body.name?.trim() || !body.command?.trim()) return fail("name and command required");
    const existing = await db.mcpServer.findFirst({
      where: { userId: user.id, name: body.name.trim() },
    });
    if (existing) return fail("An MCP server with this name already exists", 409);
    const count = await db.mcpServer.count({ where: { userId: user.id } });
    const server = await db.mcpServer.create({
      data: {
        userId: user.id,
        name: body.name.trim().slice(0, 40),
        command: body.command.trim(),
        args: JSON.stringify(body.args ?? []),
        env: JSON.stringify(body.env ?? {}),
        port: 8100 + (count % 40),
      },
    });
    return ok({ id: server.id }, 201);
  });
}

// PATCH { id, enabled? }
export async function PATCH(req: NextRequest) {
  return withAuth(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { id?: string; enabled?: boolean };
    if (!body.id) return fail("id required");
    const server = await db.mcpServer.findFirst({ where: { id: body.id, userId: user.id } });
    if (!server) return fail("MCP server not found", 404);
    await db.mcpServer.update({
      where: { id: server.id },
      data: { enabled: body.enabled ?? !server.enabled },
    });
    return ok({ success: true });
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(async (user) => {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return fail("id required");
    const server = await db.mcpServer.findFirst({ where: { id, userId: user.id } });
    if (!server) return fail("MCP server not found", 404);
    await db.mcpServer.delete({ where: { id } });
    return ok({ success: true });
  });
}

function safeParse<T>(s: string | null, fallback: T): T {
  try { return JSON.parse(s || "null") ?? fallback; } catch { return fallback; }
}
