import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { apps, chats } from "@/server/db/schema";
import { getManager } from "@/server/sandbox/manager";
import { appNameFromPrompt } from "@/server/sandbox/template-files";
import { getE2BApiKey, getRunner } from "@/server/db/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/apps — list apps with chat counts. */
export async function GET() {
  bootstrap();
  const rows = db.select().from(apps).orderBy(desc(apps.updatedAt)).all();
  const e2bConfigured = Boolean(getE2BApiKey());
  return Response.json({
    apps: rows.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      status: a.status,
      lastError: a.lastError,
      runner: a.runner,
      previewUrl: a.previewUrl,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    e2bConfigured,
    runner: getRunner(),
  });
}

/**
 * POST /api/apps — create an app.
 * Body: { name?: string, prompt?: string }
 * When `prompt` is given, an initial chat is created and the first agent turn
 * is kicked off automatically (Dyad's "build from a prompt" home flow).
 */
export async function POST(request: Request) {
  bootstrap();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    prompt?: string;
  };
  const prompt = body.prompt?.trim();
  const name = body.name?.trim() || (prompt ? appNameFromPrompt(prompt).name : "New App");
  const slug =
    body.name?.trim()
      ? `${body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app"}-${Date.now().toString(36).slice(-4)}`
      : appNameFromPrompt(prompt ?? name).slug;

  const manager = getManager();
  const app = await manager.createApp({ name, slug });

  let chatId: number | null = null;
  if (prompt) {
    const chat = db
      .insert(chats)
      .values({ appId: app.id, chatMode: "build" })
      .returning()
      .get();
    chatId = chat.id;
  }

  return Response.json({ app, chatId, prompt }, { status: 201 });
}

/** DELETE /api/apps?id=123 */
export async function DELETE(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  await getManager().deleteApp(id);
  return Response.json({ ok: true });
}

/** PATCH /api/apps?id=123 — rename / update description. */
export async function PATCH(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
  };
  if (!Number.isFinite(id)) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  db.update(apps)
    .set({
      ...(body.name ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      updatedAt: new Date(),
    })
    .where(eq(apps.id, id))
    .run();
  return Response.json({ ok: true });
}
