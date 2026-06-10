import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    return supabaseResponse;
  }

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

  const { data, error } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub && !error);

  const path = request.nextUrl.pathname;

  if (!isLoggedIn && path.startsWith("/admin")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (!isLoggedIn && path.startsWith("/api/admin") && !path.startsWith("/api/admin/internal")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isLoggedIn && path === "/login") {
    // Land everyone on the app, not the admin console: non-admin subscribers
    // would otherwise bounce to /access-denied. Admins reach /admin via nav.
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/explore";
    redirectUrl.searchParams.delete("next");
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
