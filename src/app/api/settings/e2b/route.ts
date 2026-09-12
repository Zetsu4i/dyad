import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail, maskKey } from "@/lib/api/helpers";

export async function GET() {
  return withAuth(async (user) => {
    const settings = await db.userSettings.findUnique({ where: { userId: user.id } });
    return ok({
      hasKey: Boolean(settings?.e2bApiKey),
      apiKeyMasked: maskKey(settings?.e2bApiKey),
    });
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { apiKey?: string };
    await db.userSettings.upsert({
      where: { userId: user.id },
      update: { e2bApiKey: body.apiKey?.trim() || null },
      create: { userId: user.id, e2bApiKey: body.apiKey?.trim() || null },
    });
    return ok({ success: true });
  });
}

export async function DELETE() {
  return withAuth(async (user) => {
    await db.userSettings.update({
      where: { userId: user.id },
      data: { e2bApiKey: null },
    }).catch(() => {});
    return ok({ success: true });
  });
}
