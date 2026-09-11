import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { chats, messages } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/apps/:id/chats — chat list with messages for the latest chat. */
export async function GET(request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const appId = Number(id);
  const url = new URL(request.url);
  const chatIdParam = url.searchParams.get("chatId");

  const chatRows = db
    .select()
    .from(chats)
    .where(eq(chats.appId, appId))
    .orderBy(desc(chats.id))
    .all();

  const activeChatId = chatIdParam
    ? Number(chatIdParam)
    : chatRows[0]?.id ?? null;

  const msgs = activeChatId
    ? db
        .select()
        .from(messages)
        .where(eq(messages.chatId, activeChatId))
        .orderBy(messages.id)
        .all()
    : [];

  return Response.json({ chats: chatRows, activeChatId, messages: msgs });
}

/** POST /api/apps/:id/chats — start a new chat. */
export async function POST(_request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const chat = db
    .insert(chats)
    .values({ appId: Number(id), chatMode: "build" })
    .returning()
    .get();
  return Response.json({ chat }, { status: 201 });
}
