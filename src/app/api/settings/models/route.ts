import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";

export async function GET() {
  return withAuth(async (user) => {
    const models = await db.modelConfig.findMany({
      where: { userId: user.id },
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
      include: { provider: true },
    });
    return ok({
      models: models.map((m) => ({
        id: m.id,
        modelId: m.modelId,
        displayName: m.displayName,
        isActive: m.isActive,
        isDefault: m.isDefault,
        providerId: m.providerId,
        providerName: m.provider?.name,
        providerFormat: m.provider?.format,
      })),
    });
  });
}

// POST { modelId, displayName?, providerId?, activate? } — add/ensure a model
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const body = (await req.json().catch(() => ({}))) as {
      modelId?: string;
      displayName?: string;
      providerId?: string;
      activate?: boolean;
    };
    if (!body.modelId?.trim()) return fail("modelId required");
    let providerId = body.providerId;
    if (!providerId) {
      const provider = await db.providerConfig.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { createdAt: "asc" },
      });
      if (!provider) return fail("No provider configured. Add one in Providers first.");
      providerId = provider.id;
    } else {
      const provider = await db.providerConfig.findFirst({
        where: { id: providerId, userId: user.id },
      });
      if (!provider) return fail("Provider not found", 404);
    }
    const existing = await db.modelConfig.findFirst({
      where: { userId: user.id, modelId: body.modelId },
    });
    if (existing) {
      await db.modelConfig.update({
        where: { id: existing.id },
        data: {
          ...(body.activate ? { isActive: true } : {}),
          ...(body.displayName ? { displayName: body.displayName } : {}),
        },
      });
      return ok({ id: existing.id, existed: true });
    }
    const count = await db.modelConfig.count({ where: { userId: user.id } });
    const model = await db.modelConfig.create({
      data: {
        userId: user.id,
        providerId,
        modelId: body.modelId,
        displayName: body.displayName || body.modelId,
        isActive: body.activate ?? true,
        isDefault: count === 0,
      },
    });
    return ok({ id: model.id }, 201);
  });
}

// PATCH { id, isActive?, isDefault?, displayName? }
export async function PATCH(req: NextRequest) {
  return withAuth(async (user) => {
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      isActive?: boolean;
      isDefault?: boolean;
      displayName?: string;
    };
    if (!body.id) return fail("id required");
    const model = await db.modelConfig.findFirst({ where: { id: body.id, userId: user.id } });
    if (!model) return fail("Model not found", 404);

    if (body.isDefault) {
      await db.modelConfig.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      });
    }
    await db.modelConfig.update({
      where: { id: model.id },
      data: {
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault, isActive: body.isDefault ? true : undefined } : {}),
        ...(body.displayName ? { displayName: body.displayName.slice(0, 80) } : {}),
      },
    });
    return ok({ success: true });
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(async (user) => {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return fail("id required");
    const model = await db.modelConfig.findFirst({ where: { id, userId: user.id } });
    if (!model) return fail("Model not found", 404);
    await db.modelConfig.delete({ where: { id } });
    return ok({ success: true });
  });
}
