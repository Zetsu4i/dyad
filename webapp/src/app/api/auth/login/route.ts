import { cookies } from "next/headers";
import { WORKSPACE_COOKIE, simpleHash } from "@/middleware";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/login — body: { password } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const expected = process.env.WORKSPACE_PASSWORD;
  if (!expected) {
    return Response.json({ ok: true, open: true });
  }
  if (body.password && simpleHash(body.password) === simpleHash(expected)) {
    const store = await cookies();
    store.set(WORKSPACE_COOKIE, simpleHash(expected), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, error: "Wrong password" }, { status: 401 });
}
