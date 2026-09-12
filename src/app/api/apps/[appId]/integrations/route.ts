import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import { ensureSandbox, installAppSkills, killSandbox, touchApp } from "@/lib/e2b/sandbox";
import { startMcpBridge, stopMcpBridge } from "@/lib/mcp/manager";

// Manage per-app skill/MCP selections.
// POST { type: 'skill'|'mcp', id, enabled } → toggle; re-syncs the sandbox.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      type?: string;
      id?: string;
      enabled?: boolean;
    };
    if (!body.id) return fail("id required");

    const app = await db.app.findFirst({ where: { id: appId, userId: user.id } });
    if (!app) return fail("App not found", 404);

    const entry = await ensureSandbox(appId, user.id).catch(() => null);
    await touchApp(appId);

    if (body.type === "skill") {
      const link = await db.appSkill.findUnique({
        where: { appId_skillId: { appId, skillId: body.id } },
      });
      if (!link) return fail("Skill not linked to app", 404);
      await db.appSkill.update({
        where: { appId_skillId: { appId, skillId: body.id } },
        data: { enabled: body.enabled ?? !link.enabled },
      });
      if (entry) await installAppSkills(entry).catch(() => {});
      return ok({ success: true, enabled: body.enabled ?? !link.enabled });
    }

    if (body.type === "mcp") {
      const link = await db.appMcp.findUnique({
        where: { appId_mcpServerId: { appId, mcpServerId: body.id } },
      });
      if (!link) return fail("MCP server not linked to app", 404);
      const enabled = body.enabled ?? !link.enabled;
      await db.appMcp.update({
        where: { appId_mcpServerId: { appId, mcpServerId: body.id } },
        data: { enabled },
      });
      if (entry) {
        if (enabled) {
          await startMcpBridge(entry, body.id).catch((e) => console.warn("[mcp] bridge:", e));
        } else {
          await stopMcpBridge(entry, body.id);
        }
      }
      return ok({ success: true, enabled });
    }

    return fail("type must be 'skill' or 'mcp'");
  });
}

// PUT { addSkills?: string[], addMcps?: string[] } — link new integrations to the app
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      addSkills?: string[];
      addMcps?: string[];
    };
    const app = await db.app.findFirst({ where: { id: appId, userId: user.id } });
    if (!app) return fail("App not found", 404);

    for (const skillId of body.addSkills ?? []) {
      const skill = await db.skill.findFirst({ where: { id: skillId, userId: user.id } });
      if (skill) {
        await db.appSkill.upsert({
          where: { appId_skillId: { appId, skillId } },
          update: { enabled: true },
          create: { appId, skillId, enabled: true },
        });
      }
    }
    for (const mcpId of body.addMcps ?? []) {
      const server = await db.mcpServer.findFirst({ where: { id: mcpId, userId: user.id } });
      if (server) {
        await db.appMcp.upsert({
          where: { appId_mcpServerId: { appId, mcpServerId: mcpId } },
          update: { enabled: true },
          create: { appId, mcpServerId: mcpId, enabled: true },
        });
      }
    }
    return ok({ success: true });
  });
}
