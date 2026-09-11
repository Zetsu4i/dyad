import { NextRequest, NextResponse } from "next/server";

/**
 * Optional workspace password (SaaS hardening for cloud deployments).
 * Set WORKSPACE_PASSWORD to require sign-in; leave unset for an open
 * workspace (local/self-hosted single-user mode).
 */

export const WORKSPACE_COOKIE = "dyad_workspace";

function checkPassword(request: NextRequest): boolean {
  const expected = process.env.WORKSPACE_PASSWORD;
  if (!expected) return true; // auth disabled
  const cookie = request.cookies.get(WORKSPACE_COOKIE)?.value;
  return cookie === simpleHash(expected);
}

export function simpleHash(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/preview") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.svg" ||
    pathname === "/logo.svg"
  ) {
    return NextResponse.next();
  }
  if (checkPassword(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
