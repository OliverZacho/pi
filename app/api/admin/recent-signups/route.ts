import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/** How many recent signups the sidebar feed shows. */
const FEED_LIMIT = 12;

export type SignupTier = "free" | "solo" | "team";

export type RecentSignup = {
  id: string;
  name: string | null;
  email: string;
  tier: SignupTier;
  createdAt: string;
};

/**
 * Recent signups for the admin-only sidebar feed. Gated by
 * `requireAdminSession`; the actual read uses the service-role client
 * because `user_profiles` / `subscriptions` are RLS-scoped to the owning
 * user, so a normal admin session can't see other people's rows.
 *
 * Tier mirrors the Settings display rule: a live `solo`/`team` subscription
 * (status active or trialing) shows that plan, everything else is "free".
 * A brand-new signup has no subscription row yet, so it reads as free —
 * which is what we want to surface.
 */
export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const admin = getSupabaseAdmin();

  const { data: profiles, error: profilesError } = await admin
    .from("user_profiles")
    .select("user_id, email, full_name, created_at")
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);

  if (profilesError) {
    console.error("Failed to load recent signups", profilesError);
    return NextResponse.json(
      { error: "Failed to load recent signups" },
      { status: 500 }
    );
  }

  const rows = profiles ?? [];
  const ids = rows.map((r) => r.user_id);

  const tierById = new Map<string, SignupTier>();
  if (ids.length > 0) {
    const { data: subs, error: subsError } = await admin
      .from("subscriptions")
      .select("user_id, plan, status")
      .in("user_id", ids);

    if (subsError) {
      console.error("Failed to load subscriptions for signups feed", subsError);
    } else {
      for (const sub of subs ?? []) {
        const live = sub.status === "active" || sub.status === "trialing";
        if (live && (sub.plan === "solo" || sub.plan === "team")) {
          tierById.set(sub.user_id, sub.plan);
        }
      }
    }
  }

  const signups: RecentSignup[] = rows.map((r) => ({
    id: r.user_id,
    name: r.full_name,
    email: r.email,
    tier: tierById.get(r.user_id) ?? "free",
    createdAt: r.created_at
  }));

  return NextResponse.json({ signups });
}
