import { bootstrap } from "@/server/db/bootstrap";
import {
  SETTINGS_KEYS,
  getSetting,
  setSetting,
  maskSecret,
  getE2BApiKey,
  getRunner,
} from "@/server/db/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings — workspace settings (secrets masked). */
export async function GET() {
  bootstrap();
  const e2bKey = getE2BApiKey();
  return Response.json({
    e2bApiKeyMasked: maskSecret(e2bKey),
    e2bConfigured: Boolean(e2bKey),
    e2bTemplate: getSetting(SETTINGS_KEYS.e2bTemplate) ?? "",
    runner: getRunner(),
    defaultModelKey: getSetting(SETTINGS_KEYS.defaultModelKey) ?? null,
    passwordProtected: Boolean(process.env.WORKSPACE_PASSWORD),
  });
}

/** POST /api/settings — update workspace settings. */
export async function POST(request: Request) {
  bootstrap();
  const body = (await request.json().catch(() => ({}))) as {
    e2bApiKey?: string | null;
    e2bTemplate?: string | null;
    runner?: "e2b" | "local";
    defaultModelKey?: string | null;
  };
  if (body.e2bApiKey !== undefined) {
    setSetting(SETTINGS_KEYS.e2bApiKey, body.e2bApiKey || null);
  }
  if (body.e2bTemplate !== undefined) {
    setSetting(SETTINGS_KEYS.e2bTemplate, body.e2bTemplate || null);
  }
  if (body.runner !== undefined) {
    setSetting(SETTINGS_KEYS.runner, body.runner === "local" ? "local" : "e2b");
  }
  if (body.defaultModelKey !== undefined) {
    setSetting(SETTINGS_KEYS.defaultModelKey, body.defaultModelKey || null);
  }
  return Response.json({ ok: true });
}
