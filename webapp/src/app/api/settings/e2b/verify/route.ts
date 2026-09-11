import { Sandbox } from "e2b";
import { bootstrap } from "@/server/db/bootstrap";
import { getE2BApiKey, setSetting, SETTINGS_KEYS } from "@/server/db/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/e2b/verify — validates an E2B API key by listing
 * sandboxes. Body: { apiKey?: string } (falls back to the stored key).
 */
export async function POST(request: Request) {
  bootstrap();
  const body = (await request.json().catch(() => ({}))) as { apiKey?: string };
  const key = body.apiKey?.trim() || getE2BApiKey();
  if (!key) {
    return Response.json(
      { ok: false, error: "No E2B API key provided or stored." },
      { status: 400 },
    );
  }
  try {
    // Cheap authenticated read: first page of the sandbox listing.
    const paginator = Sandbox.list({ apiKey: key });
    if (paginator.hasNext) {
      await paginator.nextItems();
    }
    if (body.apiKey?.trim()) {
      setSetting(SETTINGS_KEYS.e2bApiKey, body.apiKey.trim());
    }
    return Response.json({
      ok: true,
      message: "E2B key verified — cloud sandboxes are ready to use.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "E2B verification failed (network or key problem).",
      },
      { status: 400 },
    );
  }
}
