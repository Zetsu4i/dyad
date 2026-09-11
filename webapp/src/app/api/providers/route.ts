import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { models, providers } from "@/server/db/schema";
import { maskSecret } from "@/server/db/settings";
import {
  fetchProviderModels,
  normalizeBaseUrl,
  type ProviderType,
} from "@/server/llm/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/providers — list providers with their models (keys masked). */
export async function GET() {
  bootstrap();
  const providerRows = db.select().from(providers).all();
  const modelRows = db.select().from(models).all();
  return Response.json({
    providers: providerRows.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKeyMasked: maskSecret(p.apiKey),
      hasApiKey: Boolean(p.apiKey),
      isDefault: p.isDefault,
      models: modelRows
        .filter((m) => m.providerId === p.id)
        .map((m) => ({
          id: m.id,
          modelId: m.modelId,
          displayName: m.displayName,
          active: m.active,
        })),
    })),
  });
}

/**
 * POST /api/providers — create a provider.
 * Body: { name, type, baseUrl, apiKey?, modelIds?: string[] (activate these) }
 */
export async function POST(request: Request) {
  bootstrap();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    type?: ProviderType;
    baseUrl?: string;
    apiKey?: string;
    modelIds?: string[];
  };
  if (!body.name || !body.type || !body.baseUrl) {
    return Response.json(
      { error: "name, type and baseUrl are required" },
      { status: 400 },
    );
  }
  if (!["openai-compatible", "anthropic-compatible", "demo"].includes(body.type)) {
    return Response.json({ error: "invalid provider type" }, { status: 400 });
  }
  const inserted = db
    .insert(providers)
    .values({
      name: body.name,
      type: body.type,
      baseUrl: normalizeBaseUrl(body.baseUrl),
      apiKey: body.apiKey?.trim() || null,
    })
    .returning()
    .get();

  for (const modelId of body.modelIds ?? []) {
    db.insert(models)
      .values({
        providerId: inserted.id,
        modelId,
        displayName: modelId,
        active: true,
      })
      .onConflictDoNothing()
      .run();
  }
  return Response.json({ provider: inserted }, { status: 201 });
}

/**
 * PATCH /api/providers?id=1 — update provider; optional actions:
 * { action: "pull-models" } → fetch + upsert model list (all inactive),
 * { action: "set-models", modelIds } → replace the active set.
 */
export async function PATCH(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    baseUrl?: string;
    apiKey?: string | null;
    action?: "pull-models" | "set-models";
    modelIds?: string[];
  };
  const provider = db.select().from(providers).where(eq(providers.id, id)).get();
  if (!provider) {
    return Response.json({ error: "provider not found" }, { status: 404 });
  }

  if (body.name) {
    db.update(providers).set({ name: body.name }).where(eq(providers.id, id)).run();
  }
  if (body.baseUrl) {
    db.update(providers)
      .set({ baseUrl: normalizeBaseUrl(body.baseUrl) })
      .where(eq(providers.id, id))
      .run();
  }
  if (body.apiKey !== undefined) {
    db.update(providers)
      .set({ apiKey: body.apiKey?.trim() || null })
      .where(eq(providers.id, id))
      .run();
  }

  if (body.action === "pull-models") {
    if (provider.type === "demo") {
      db.insert(models)
        .values({ providerId: id, modelId: "demo/app", displayName: "Demo app builder", active: true })
        .onConflictDoNothing()
        .run();
      return Response.json({ ok: true, models: [{ id: "demo/app" }] });
    }
    const fetched = await fetchProviderModels(
      provider.type as "openai-compatible" | "anthropic-compatible",
      body.baseUrl ?? provider.baseUrl,
      body.apiKey !== undefined ? body.apiKey : provider.apiKey,
    );
    for (const m of fetched) {
      db.insert(models)
        .values({ providerId: id, modelId: m.id, displayName: m.displayName ?? m.id })
        .onConflictDoNothing()
        .run();
    }
    const all = db.select().from(models).where(eq(models.providerId, id)).all();
    return Response.json({
      ok: true,
      models: all.map((m) => ({
        id: m.modelId,
        displayName: m.displayName,
        active: m.active,
      })),
      fetched: fetched.length,
    });
  }

  if (body.action === "set-models") {
    const ids = new Set(body.modelIds ?? []);
    const all = db.select().from(models).where(eq(models.providerId, id)).all();
    for (const m of all) {
      const active = ids.has(m.modelId);
      if (active !== m.active) {
        db.update(models).set({ active }).where(eq(models.id, m.id)).run();
      }
    }
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true });
}

/** DELETE /api/providers?id=1 */
export async function DELETE(request: Request) {
  bootstrap();
  const id = Number(new URL(request.url).searchParams.get("id"));
  db.delete(providers).where(eq(providers.id, id)).run();
  return Response.json({ ok: true });
}
