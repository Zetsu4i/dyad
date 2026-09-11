import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { appMcps, appSkills } from "@/server/db/schema";
import { skillsForApp, attachSkill } from "@/server/skills/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/apps/:id/attachments — skills + MCP servers attached to the app. */
export async function GET(_request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const appId = Number(id);
  const attachedSkills = skillsForApp(appId).map((s) => s.id);
  const attachedMcps = (
    db.select().from(appMcps).where(eq(appMcps.appId, appId)).all() as {
      mcpId: number;
    }[]
  ).map((r) => r.mcpId);
  return Response.json({ skillIds: attachedSkills, mcpIds: attachedMcps });
}

/** POST /api/apps/:id/attachments — attach/detach. Body: { kind, id, attached } */
export async function POST(request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const appId = Number(id);
  const body = (await request.json().catch(() => ({}))) as {
    kind?: "skill" | "mcp";
    id?: number;
    attached?: boolean;
  };
  if (!body.kind || !body.id) {
    return Response.json({ error: "kind and id required" }, { status: 400 });
  }
  if (body.kind === "skill") {
    attachSkill(appId, body.id, body.attached ?? true);
  } else if (body.attached ?? true) {
    db.insert(appMcps)
      .values({ appId, mcpId: body.id })
      .onConflictDoNothing()
      .run();
  } else {
    db.delete(appMcps)
      .where(and(eq(appMcps.appId, appId), eq(appMcps.mcpId, body.id)))
      .run();
  }
  return Response.json({ ok: true });
}
