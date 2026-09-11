import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { skills } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/skills — all skills. */
export async function GET() {
  bootstrap();
  const rows = db.select().from(skills).all();
  return Response.json({
    skills: rows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      files: s.files,
      enabled: s.enabled,
      source: s.source,
    })),
  });
}

/** POST /api/skills — create a custom skill. */
export async function POST(request: Request) {
  bootstrap();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    instructions?: string;
  };
  if (!body.name || !body.description || !body.instructions) {
    return Response.json(
      { error: "name, description and instructions are required" },
      { status: 400 },
    );
  }
  const slug =
    body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `skill-${Date.now().toString(36)}`;
  const inserted = db
    .insert(skills)
    .values({
      slug: `${slug}-${Date.now().toString(36).slice(-3)}`,
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      source: "custom",
      enabled: true,
    })
    .returning()
    .get();
  return Response.json({ skill: inserted }, { status: 201 });
}

/** PATCH /api/skills?id=1 — edit / enable / disable. */
export async function PATCH(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    instructions?: string;
    enabled?: boolean;
  };
  const skill = db.select().from(skills).where(eq(skills.id, id)).get();
  if (!skill) return Response.json({ error: "not found" }, { status: 404 });
  db.update(skills)
    .set({
      ...(body.name ? { name: body.name } : {}),
      ...(body.description ? { description: body.description } : {}),
      ...(body.instructions ? { instructions: body.instructions } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    })
    .where(eq(skills.id, id))
    .run();
  return Response.json({ ok: true });
}

/** DELETE /api/skills?id=1 — custom skills only. */
export async function DELETE(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  const skill = db.select().from(skills).where(eq(skills.id, id)).get();
  if (skill?.source === "gallery") {
    return Response.json(
      { error: "Gallery skills can be disabled but not deleted" },
      { status: 400 },
    );
  }
  db.delete(skills).where(eq(skills.id, id)).run();
  return Response.json({ ok: true });
}
