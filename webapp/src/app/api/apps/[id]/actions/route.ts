import { bootstrap } from "@/server/db/bootstrap";
import { getManager } from "@/server/sandbox/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/apps/:id/actions
 * Body: { action: "start" | "stop" | "rebuild" | "restart" | "refresh" }
 *
 * These are the three commands the Dyad prompt can suggest
 * (<dyad-command type="rebuild|restart|refresh">) plus start/stop.
 */
export async function POST(request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const appId = Number(id);
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const manager = getManager();
  const log = (line: string) => console.log(`[app ${appId}]`, line);

  try {
    switch (body.action) {
      case "start": {
        const app = await manager.startApp(appId, log);
        return Response.json({ ok: true, app });
      }
      case "stop": {
        const app = await manager.stopApp(appId, log);
        return Response.json({ ok: true, app });
      }
      case "rebuild": {
        const app = await manager.rebuild(appId, log);
        return Response.json({ ok: true, app });
      }
      case "restart": {
        const app = await manager.restart(appId, log);
        return Response.json({ ok: true, app });
      }
      case "refresh": {
        const app = await manager.refresh(appId);
        return Response.json({ ok: true, app });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
