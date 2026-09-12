import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import { TEMPLATES } from "@/lib/e2b/templates";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  templateId: z.string().default("react-vite"),
});

export async function GET() {
  return withAuth(async (user) => {
    const apps = await db.app.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { chats: true } },
      },
    });
    return ok({
      apps: apps.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        templateId: a.templateId,
        sandboxStatus: a.sandboxStatus,
        updatedAt: a.updatedAt,
        createdAt: a.createdAt,
        chatCount: a._count.chats,
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid app payload");
    const { name, description, templateId } = parsed.data;
    if (!TEMPLATES.some((t) => t.id === templateId)) {
      return fail("Unknown template");
    }
    const app = await db.app.create({
      data: {
        userId: user.id,
        name: name.trim(),
        description: description?.trim(),
        templateId,
        sandboxStatus: "none",
      },
    });
    const chat = await db.chat.create({
      data: { appId: app.id, title: name.trim() },
    });
    return ok({ app: { ...app, chatCount: 1 }, chatId: chat.id }, 201);
  });
}
