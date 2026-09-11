import { bootstrap } from "@/server/db/bootstrap";
import { getManager } from "@/server/sandbox/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/apps/:id/status — sandbox status + preview URL + recent logs. */
export async function GET(_request: Request, { params }: Params) {
  bootstrap();
  const { id } = await params;
  const manager = getManager();
  const status = await manager.statusOf(Number(id));
  return Response.json({ ...status, logs: manager.getLogs(Number(id)).slice(-200) });
}
