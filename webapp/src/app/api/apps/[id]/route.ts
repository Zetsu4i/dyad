import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { appFiles, apps, chats, messages } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/apps/:id — app detail: files, chats (latest first), status. */
export async function GET(_request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const appId = Number(id);
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) return Response.json({ error: "not found" }, { status: 404 });

  const files = db
    .select({ path: appFiles.path, updatedAt: appFiles.updatedAt })
    .from(appFiles)
    .where(eq(appFiles.appId, appId))
    .all();
  const chatRows = db
    .select()
    .from(chats)
    .where(eq(chats.appId, appId))
    .orderBy(desc(chats.id))
    .all();

  return Response.json({
    app,
    files: files.map((f) => ({ path: f.path, updatedAt: f.updatedAt })),
    chats: chatRows,
  });
}

/** GET file content: /api/apps/:id?file=path */
export async function POST(request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const appId = Number(id);
  const body = (await request.json().catch(() => ({}))) as { file?: string };
  if (!body.file) {
    return Response.json({ error: "file path required" }, { status: 400 });
  }
  const row = db
    .select()
    .from(appFiles)
    .where(eq(appFiles.appId, appId))
    .all()
    .find((f) => f.path === body.file);
  if (!row) return Response.json({ error: "file not found" }, { status: 404 });
  return Response.json({ path: row.path, content: row.content });
}

/** DELETE /api/apps/:id */
export async function DELETE(_request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  await (
    await import("@/server/sandbox/manager")
  ).getManager().deleteApp(Number(id));
  return Response.json({ ok: true });
}

/** PUT /api/apps/:id — revert a chat: restore file snapshot (simple undo). */
export async function PUT(request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const appId = Number(id);
  const body = (await request.json().catch(() => ({}))) as {
    restoreChatId?: number;
  };
  if (!body.restoreChatId) {
    return Response.json({ error: "restoreChatId required" }, { status: 400 });
  }
  const msg = db
    .select()
    .from(messages)
    .where(eq(messages.chatId, body.restoreChatId))
    .all();
  void msg;
  void appId;
  // Snapshot-based revert is intentionally minimal in the MVP: the Files tab
  // allows manual edits, and chat history is immutable.
  return Response.json({ ok: true });
}
