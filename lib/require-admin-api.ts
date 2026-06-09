import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

type SessionUser = { id: string; email: string | null };
type AdminSessionOk = { supabase: SupabaseClient<Database>; user: SessionUser };
type AdminSessionErr = { response: NextResponse };

/**
 * Resolve the request's session id by **verifying the JWT locally** with
 * `getClaims()` (against the project's asymmetric signing key) — no call to
 * the Supabase Auth server, so route handlers don't burn the auth rate limit.
 */
async function resolveSession(): Promise<
  { supabase: SupabaseClient<Database>; user: SessionUser } | null
> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) {
    return null;
  }
  return {
    supabase,
    user: {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null
    }
  };
}

export async function requireAdminSession(): Promise<
  AdminSessionOk | AdminSessionErr
> {
  const session = await resolveSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }

  const { data: adminRow, error: adminError } = await session.supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 })
    };
  }

  return session;
}

/**
 * Gate for subscriber-facing API routes (Explore, Collections, Compare,
 * Following, Brands). Admits anyone with archive entitlement — admin OR an
 * active subscription — checked via the same `has_archive_access()` DB
 * function RLS uses, so the API gate and the row-level policies can't drift.
 *
 * Admin-only routes (`/api/admin/*`) keep using `requireAdminSession`.
 */
export async function requireArchiveAccess(): Promise<
  AdminSessionOk | AdminSessionErr
> {
  const session = await resolveSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }

  const { data: access, error: accessError } =
    await session.supabase.rpc("has_archive_access");

  if (accessError || !access) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 })
    };
  }

  return session;
}
