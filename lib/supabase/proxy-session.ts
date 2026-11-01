import {
  combineChunks,
  createServerClient,
  isChunkLike,
  stringFromBase64URL
} from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase";

/**
 * Logged-out requests for these public brand paths are rewritten to the
 * cached copies under /guest (app/guest), so crawlers and anonymous visitors
 * are served from the CDN instead of rendering per request.
 */
const GUEST_CACHED_PATH = /^\/brands(?:\/[^/]+)?\/?$/;
const GUEST_PREFIX = "/guest";

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  // A session cookie that can't be decoded (a lost or corrupted chunk) makes
  // Supabase throw, from getClaims and from the client's own background
  // initialisation alike, which 500'd every route. Strip it before the
  // client is created; the browser's copy is expired on the response below.
  const authKey = authStorageKey(url);
  const droppedAuthCookies = (await hasUndecodableAuthCookie(request, authKey))
    ? removeAuthCookies(request, authKey)
    : [];

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(responseHeaders).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      }
    }
  });

  let isLoggedIn = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    isLoggedIn = Boolean(data?.claims?.sub && !error);
  } catch (err) {
    // Unexpected: treat as logged out for this request, but keep the cookie
    // so a passing failure never signs out a valid session.
    console.error("Session check failed", err);
  }
  droppedAuthCookies.forEach((name) =>
    supabaseResponse.cookies.set(name, "", { path: "/", maxAge: 0 })
  );

  const path = request.nextUrl.pathname;

  // /guest is an internal rewrite target only; reachable directly it would
  // be a duplicate of every public brand URL.
  if (path === GUEST_PREFIX || path.startsWith(`${GUEST_PREFIX}/`)) {
    return new NextResponse(null, { status: 404 });
  }

  // Any signed-in viewer (free users too: they get follow state and live
  // teaser data) stays on the per-request route.
  if (!isLoggedIn && GUEST_CACHED_PATH.test(path)) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `${GUEST_PREFIX}${path}`;
    const rewrite = NextResponse.rewrite(rewriteUrl, { request });
    // Carry over anything getClaims set, e.g. clearing a dead session cookie.
    supabaseResponse.cookies.getAll().forEach((cookie) => rewrite.cookies.set(cookie));
    supabaseResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === "cache-control") rewrite.headers.set(key, value);
    });
    return rewrite;
  }

  if (!isLoggedIn && path.startsWith("/admin")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (!isLoggedIn && path.startsWith("/api/admin") && !path.startsWith("/api/admin/internal")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isLoggedIn && (path === "/login" || path === "/signup")) {
    // Land everyone on the app, not the admin console: non-admin subscribers
    // would otherwise bounce to /access-denied. Admins reach /admin via nav.
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/explore";
    redirectUrl.searchParams.delete("next");
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

/**
 * The session cookie name supabase-js uses by default: `sb-<first label of
 * the project URL's host>-auth-token`, chunked as `.0`, `.1`… when large.
 */
function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/**
 * Whether the session cookie fails to decode, checked with the same
 * @supabase/ssr helpers that read it (a lost chunk leaves a truncated value).
 */
async function hasUndecodableAuthCookie(request: NextRequest, key: string): Promise<boolean> {
  try {
    const value = await combineChunks(key, (name) => request.cookies.get(name)?.value ?? null);
    if (value?.startsWith("base64-")) stringFromBase64URL(value.slice("base64-".length));
    return false;
  } catch {
    return true;
  }
}

/** Strips the session cookie (all chunks) from the request; returns the names removed. */
function removeAuthCookies(request: NextRequest, key: string): string[] {
  const names = request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => name === key || isChunkLike(name, key));
  names.forEach((name) => request.cookies.delete(name));
  return names;
}
