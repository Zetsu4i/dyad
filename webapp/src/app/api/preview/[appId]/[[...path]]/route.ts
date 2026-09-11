import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { bootstrap } from "@/server/db/bootstrap";
import { apps } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORT_BASE = 9100;

/**
 * GET|POST /api/preview/:appId/** — proxies the LOCAL runner's vite dev
 * server (E2B apps are previewed directly from the sandbox's public URL and
 * never hit this route).
 *
 * Vite runs with `base = /api/preview/{appId}/`, so the full incoming path is
 * forwarded as-is; asset URLs emitted by the app resolve through this proxy
 * without rewrites.
 */
async function proxy(request: NextRequest, appId: number, path: string[]) {
  bootstrap();
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) return new Response("App not found", { status: 404 });

  const port = app.previewPort ?? PORT_BASE + appId;
  const vitePath = `/api/preview/${appId}/${path.join("/")}`;
  const url = new URL(vitePath, `http://127.0.0.1:${port}`);
  url.search = new URL(request.url).search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");

  try {
    const res = await fetch(url, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const resHeaders = new Headers(res.headers);
    resHeaders.delete("content-encoding");
    resHeaders.delete("content-length");
    resHeaders.delete("transfer-encoding");
    resHeaders.delete("x-frame-options");
    resHeaders.set("Cache-Control", "no-store");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    return new Response(
      `<html><body style="font-family:ui-sans-serif;background:#09090b;color:#a1a1aa;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#e4e4e7">Preview offline</h2><p style="font-size:14px">${
        err instanceof Error ? err.message : "Dev server not reachable"
      }</p><p style="font-size:13px;color:#71717a">Start the app with the Run button or send a chat message.</p></div></body></html>`,
      { status: 502, headers: { "Content-Type": "text/html" } },
    );
  }
}

type Params = { params: Promise<{ appId: string; path?: string[] }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { appId, path } = await params;
  return proxy(request, Number(appId), path ?? []);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { appId, path } = await params;
  return proxy(request, Number(appId), path ?? []);
}
