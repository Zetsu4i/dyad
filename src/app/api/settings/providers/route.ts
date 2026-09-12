import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail, maskKey } from "@/lib/api/helpers";

export async function GET() {
  return withAuth(async (user) => {
    const providers = await db.providerConfig.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        format: p.format,
        baseUrl: p.baseUrl,
        apiKeyMasked: maskKey(p.apiKey),
        hasKey: Boolean(p.apiKey),
        isActive: p.isActive,
      })),
    });
  });
}

// PUT { providerId?, name?, format, baseUrl, apiKey? } — create or update
export async function PUT(req: NextRequest) {
  return withAuth(async (user) => {
    const body = (await req.json().catch(() => ({}))) as {
      providerId?: string;
      name?: string;
      format?: string;
      baseUrl?: string;
      apiKey?: string;
    };
    const format = body.format === "anthropic" ? "anthropic" : "openai";
    const baseUrl = (body.baseUrl ?? "").trim();
    if (body.providerId) {
      const provider = await db.providerConfig.findFirst({
        where: { id: body.providerId, userId: user.id },
      });
      if (!provider) return fail("Provider not found", 404);
      await db.providerConfig.update({
        where: { id: provider.id },
        data: {
          ...(body.name ? { name: body.name.slice(0, 60) } : {}),
          format,
          ...(baseUrl ? { baseUrl } : {}),
          ...(body.apiKey !== undefined ? { apiKey: body.apiKey || null } : {}),
        },
      });
      return ok({ success: true });
    }
    if (!baseUrl) return fail("baseUrl required");
    const provider = await db.providerConfig.create({
      data: {
        userId: user.id,
        name: body.name?.slice(0, 60) || (format === "anthropic" ? "Anthropic Gateway" : "OpenAI Gateway"),
        format,
        baseUrl,
        apiKey: body.apiKey || null,
      },
    });
    return ok({ id: provider.id }, 201);
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(async (user) => {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return fail("id required");
    const provider = await db.providerConfig.findFirst({ where: { id, userId: user.id } });
    if (!provider) return fail("Provider not found", 404);
    await db.providerConfig.delete({ where: { id } });
    return ok({ success: true });
  });
}
