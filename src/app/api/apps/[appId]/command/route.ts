import { NextRequest } from "next/server";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import { runSandboxCommand } from "@/lib/e2b/sandbox";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { command?: string; timeoutMs?: number };
    if (!body.command?.trim()) return fail("command required");
    const timeout = Math.min(body.timeoutMs ?? 120_000, 300_000);
    try {
      const result = await runSandboxCommand(appId, user.id, body.command, timeout);
      return ok({ ...result });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Command failed");
    }
  });
}
