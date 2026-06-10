import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PirolSupabaseClient } from "@/lib/supabase-admin";

/**
 * The signed-in viewer, their entitlement, and admin status.
 *
 * `isAdmin` gates admin-only surfaces (`/admin`, archive writes). `hasAccess`
 * (admin OR active/trialing subscription) gates the product for everyone
 * else — `hasAccess` users get the full app, everyone else (logged-out or
 * unpaid) gets the locked teaser. `hasAccess` is sourced from the DB
 * `has_archive_access()` function so the app and RLS can never disagree.
 */
export type Viewer = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  hasAccess: boolean;
};

/**
 * How many curated emails a public (non-admin) user sees in Explore before
 * the paywall. Kept here so the page fetch and any future copy ("+N more")
 * read the same number.
 */
export const PUBLIC_EXPLORE_LIMIT = 16;

/**
 * How many emails a signed-in but unpaid user may save. Saving is the
 * free conversion hook: free users bookmark curated preview emails up to
 * this cap, then get nudged to upgrade. Paid/admin users are unlimited.
 */
export const FREE_SAVE_LIMIT = 25;

/**
 * Resolve the current viewer for this request.
 *
 * Identity comes from `getClaims()`, which **verifies the session JWT
 * locally** against the project's asymmetric signing key (ES256) — no call
 * to the Supabase Auth server, so it doesn't count against the auth rate
 * limit and adds ~no latency. Wrapped in React `cache()` so the layout, the
 * page, and the sidebar share a single resolution per request instead of
 * each re-verifying and re-querying.
 *
 * Returns `null` when nobody is signed in. A transient verification error is
 * also treated as "no viewer" but never triggers an auth-server retry, so it
 * can't spiral into a redirect loop the way a rate-limited `getUser()` could.
 */
export const getViewer = cache(
  async (): Promise<Viewer | null> => resolveViewer(await createClient())
);

/**
 * The pure resolution given a request-scoped client — split out so it's
 * unit-testable without the React `cache()` wrapper or a real Supabase
 * client. Application code should call {@link getViewer}.
 */
export async function resolveViewer(
  supabase: PirolSupabaseClient
): Promise<Viewer | null> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) {
    return null;
  }
  const userId = claims.sub;

  // `isAdmin` for admin-only surfaces; `hasAccess` (admin OR active
  // subscription) for product entitlement, read from the same DB function
  // RLS uses so the two can never disagree. Both are DB reads (not auth), so
  // they don't hit the auth rate limit.
  const [{ data: adminRow }, { data: access }] = await Promise.all([
    supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.rpc("has_archive_access")
  ]);

  const isAdmin = Boolean(adminRow);
  return {
    userId,
    email: typeof claims.email === "string" ? claims.email : null,
    isAdmin,
    hasAccess: isAdmin || Boolean(access)
  };
}
