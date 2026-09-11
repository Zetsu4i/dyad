import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { models, providers } from "@/server/db/schema";
import { SETTINGS_KEYS, setSetting } from "@/server/db/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/models — all activated models (the builder's model picker). */
export async function GET() {
  bootstrap();
  const rows = db
    .select({
      id: models.id,
      providerId: models.providerId,
      providerName: providers.name,
      providerType: providers.type,
      modelId: models.modelId,
      displayName: models.displayName,
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(eq(models.active, true))
    .all();
  return Response.json({ models: rows });
}

/** POST /api/models — toggle activation: { providerId, modelId, active, makeDefault? } */
export async function POST(request: Request) {
  bootstrap();
  const body = (await request.json().catch(() => ({}))) as {
    providerId?: number;
    modelId?: string;
    active?: boolean;
    makeDefault?: boolean;
  };
  if (!body.providerId || !body.modelId) {
    return Response.json({ error: "providerId and modelId required" }, { status: 400 });
  }
  const key = `${body.providerId}:${body.modelId}`;
  db.update(models)
    .set({ active: body.active ?? true })
    .where(and(eq(models.providerId, body.providerId), eq(models.modelId, body.modelId)))
    .run();
  if (body.makeDefault) {
    setSetting(SETTINGS_KEYS.defaultModelKey, key);
  }
  return Response.json({ ok: true, key });
}
