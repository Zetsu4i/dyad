import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import { killSandbox } from "@/lib/e2b/sandbox";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const app = await db.app.findFirst({
      where: { id: appId, userId: user.id },
      include: {
        chats: { orderBy: { updatedAt: "desc" }, include: { _count: { select: { messages: true } } } },
        appSkills: { include: { skill: true } },
        appMcps: { include: { mcpServer: true } },
      },
    });
    if (!app) return fail("App not found", 404);
    return ok({
      app: {
        id: app.id,
        name: app.name,
        description: app.description,
        templateId: app.templateId,
        sandboxStatus: app.sandboxStatus,
        sandboxId: app.sandboxId,
        previewPort: app.previewPort,
        updatedAt: app.updatedAt,
        createdAt: app.createdAt,
      },
      chats: app.chats.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        messageCount: c._count.messages,
      })),
      skills: app.appSkills.map((s) => ({
        skillId: s.skillId,
        slug: s.skill.slug,
        name: s.skill.name,
        description: s.skill.description,
        enabled: s.enabled,
        globallyEnabled: s.skill.enabled,
      })),
      mcpServers: app.appMcps.map((m) => ({
        id: m.mcpServer.id,
        name: m.mcpServer.name,
        status: m.mcpServer.status,
        enabled: m.enabled,
        globallyEnabled: m.mcpServer.enabled,
        toolCount: (() => {
          try { return (JSON.parse(m.mcpServer.toolsJson || "[]") as unknown[]).length; } catch { return 0; }
        })(),
      })),
    });
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string };
    const app = await db.app.findFirst({ where: { id: appId, userId: user.id } });
    if (!app) return fail("App not found", 404);
    await db.app.update({
      where: { id: appId },
      data: {
        ...(body.name ? { name: body.name.trim().slice(0, 60) } : {}),
        ...(body.description !== undefined ? { description: body.description.slice(0, 300) } : {}),
      },
    });
    return ok({ success: true });
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const app = await db.app.findFirst({ where: { id: appId, userId: user.id } });
    if (!app) return fail("App not found", 404);
    await killSandbox(appId);
    await db.app.delete({ where: { id: appId } });
    return ok({ success: true });
  });
}
