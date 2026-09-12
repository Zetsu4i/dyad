import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import {
  ensureSandbox,
  pauseSandbox,
  restartApp,
  reinstallAndRestartApp,
  getSandboxStatus,
  touchApp,
} from "@/lib/e2b/sandbox";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const status = await getSandboxStatus(appId, user.id);
    return ok(status);
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    switch (body.action) {
      case "start":
      case "resume": {
        await touchApp(appId);
        const entry = await ensureSandbox(appId, user.id);
        const app = await db.app.findUnique({ where: { id: appId } });
        return ok({
          status: "running",
          sandboxId: entry.sandbox.sandboxId,
          previewUrl: `https://${entry.sandbox.getHost(app?.previewPort ?? 5173)}`,
        });
      }
      case "pause": {
        await pauseSandbox(appId, user.id);
        return ok({ status: "paused" });
      }
      case "restart": {
        await restartApp(appId, user.id);
        return ok({ status: "restarted" });
      }
      case "reinstall": {
        await reinstallAndRestartApp(appId, user.id);
        return ok({ status: "reinstalled" });
      }
      default:
        return fail("Unknown action. Use start|pause|restart|reinstall");
    }
  });
}

