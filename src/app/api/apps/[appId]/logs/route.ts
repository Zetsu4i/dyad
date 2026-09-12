import { NextRequest } from "next/server";
import { withAuth, ok } from "@/lib/api/helpers";
import { getDevLogs } from "@/lib/e2b/sandbox";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    return ok({ logs: await getDevLogs(appId) });
  });
}
