import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import { runAgentTurn } from "@/lib/agent/runner";

export const maxDuration = 600;

// SSE streaming agent turn
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  const { appId } = await ctx.params;

  // Auth check before opening the stream
  let user;
  try {
    const { requireAuth } = await import("@/lib/auth");
    user = await requireAuth();
  } catch {
    return fail("Unauthorized", 401);
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    chatId?: string;
    modelConfigId?: string;
  };
  if (!body.message || !body.message.trim()) {
    return fail("Message required");
  }

  const app = await db.app.findFirst({ where: { id: appId, userId: user.id } });
  if (!app) return fail("App not found", 404);

  // Resolve or create chat
  let chat = body.chatId
    ? await db.chat.findFirst({ where: { id: body.chatId, app: { userId: user.id } } })
    : null;
  if (!chat) {
    chat = await db.chat.create({ data: { appId, title: body.message.slice(0, 60) } });
  }

  const chatId = chat.id;
  const userMessage = body.message.trim();
  const modelConfigId = body.modelConfigId;
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (evt: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: "chat", chatId });
      try {
        await runAgentTurn({
          appId,
          userId: user.id,
          chatId,
          userMessage,
          modelConfigId,
          emit: send,
          signal: abortController.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {}
        }
        closed = true;
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Load message history
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const chatId = new URL(req.url).searchParams.get("chatId");
    const chat = chatId
      ? await db.chat.findFirst({ where: { id: chatId, app: { userId: user.id } } })
      : null;
    if (!chat) return fail("Chat not found", 404);
    const messages = await db.message.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      chat: { id: chat.id, title: chat.title },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        thinking: m.thinking,
        toolTrace: m.toolTrace,
        modelId: m.modelId,
        createdAt: m.createdAt,
      })),
    });
  });
}

// Create a new chat for the app
export async function PUT(
  _req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const app = await db.app.findFirst({ where: { id: appId, userId: user.id } });
    if (!app) return fail("App not found", 404);
    const chat = await db.chat.create({ data: { appId, title: "New chat" } });
    return ok({ chatId: chat.id }, 201);
  });
}
