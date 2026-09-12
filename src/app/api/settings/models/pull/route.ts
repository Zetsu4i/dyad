import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import { pullModels } from "@/lib/agent/provider";

// POST { providerId?, activateIds?: string[] } — pull the live model list and
// (optionally) activate selected ones. Returns the full fetched catalog.
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const body = (await req.json().catch(() => ({}))) as {
      providerId?: string;
      activateIds?: string[];
    };
    const provider = body.providerId
      ? await db.providerConfig.findFirst({ where: { id: body.providerId, userId: user.id } })
      : await db.providerConfig.findFirst({
          where: { userId: user.id, isActive: true },
          orderBy: { createdAt: "asc" },
        });
    if (!provider) return fail("No provider configured. Add one in Providers first.");

    const models = await pullModels(provider.baseUrl, provider.apiKey);
    const existing = await db.modelConfig.findMany({ where: { userId: user.id } });
    const existingIds = new Set(existing.map((m) => m.modelId));

    // Ensure pulled models exist in DB (inactive by default).
    // The provider list may contain duplicates — track what we insert.
    for (const m of models) {
      if (existingIds.has(m.id)) continue;
      existingIds.add(m.id);
      await db.modelConfig.create({
        data: {
          userId: user.id,
          providerId: provider.id,
          modelId: m.id,
          displayName: m.name || m.id,
          isActive: false,
          isDefault: false,
        },
      }).catch(() => {}); // tolerate races/duplicates
    }

    // Activate requested models
    if (body.activateIds?.length) {
      for (const id of body.activateIds) {
        const model = await db.modelConfig.findFirst({ where: { userId: user.id, modelId: id } });
        if (model) {
          await db.modelConfig.update({ where: { id: model.id }, data: { isActive: true } });
        }
      }
    }

    return ok({
      provider: { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, format: provider.format },
      models,
    });
  });
}
