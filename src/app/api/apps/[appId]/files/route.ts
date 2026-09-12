import { NextRequest } from "next/server";
import { withAuth, ok, fail } from "@/lib/api/helpers";
import {
  listFilesRecursive,
  readSandboxFile,
  writeSandboxFile,
  isIgnored,
} from "@/lib/e2b/sandbox";

// GET ?path=file.txt → file content; GET (no path) → file tree
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const path = new URL(req.url).searchParams.get("path");
    if (path === null) {
      const tree = await listFilesRecursive(appId, user.id);
      return ok({ tree });
    }
    const rel = path.replace(/^\/+/, "");
    if (isIgnored(rel)) return fail("Path is ignored", 403, "ignored");
    try {
      const content = await readSandboxFile(appId, user.id, rel);
      return ok({ path: rel, content });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to read file", 404);
    }
  });
}

// PUT {path, content} → save file
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> }
) {
  return withAuth(async (user) => {
    const { appId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { path?: string; content?: string };
    if (!body.path) return fail("path required");
    try {
      await writeSandboxFile(appId, user.id, body.path, body.content ?? "");
      return ok({ success: true });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to write file");
    }
  });
}

