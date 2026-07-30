import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { labelForUpgradeSource } from "@/lib/upgrade-clicks-db";
import { labelForNavId } from "@/lib/nav-clicks-db";
import type { SignupTier } from "@/app/api/admin/recent-signups/route";

export const dynamic = "force-dynamic";

/** Cap for the "recent items" lists in the popout — it's a glance, not a log. */
const LIST_LIMIT = 8;

export type UserActivity = {
  profile: {
    email: string;
    name: string | null;
    createdAt: string;
    lastVisitAt: string | null;
    lastActiveAt: string | null;
    tourCompletedAt: string | null;
    planSelectedAt: string | null;
    passwordSetAt: string | null;
  };
  auth: {
    provider: string | null;
    lastSignInAt: string | null;
  };
  tier: SignupTier;
  savedCount: number;
  collections: { name: string; createdAt: string }[];
  followedBrands: string[];
  competitorSets: { name: string; createdAt: string }[];
  upgradeClicks: {
    total: number;
    recent: { label: string; path: string | null; createdAt: string }[];
  };
  navClicks: { navId: string; label: string; count: number; lastAt: string }[];
};

/**
 * Everything we capture on a single user, for the admin signups-feed popout.
 * Gated by `requireAdminSession`; reads use the service-role client because
 * all these tables are RLS-scoped to the owning user.
 */
export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  try {
    const [
      profileRes,
      authRes,
      subRes,
      savedRes,
      collectionsRes,
      followsRes,
      setsRes,
      upgradesRes,
      navRes
    ] = await Promise.all([
      admin
        .from("user_profiles")
        .select(
          "email, full_name, created_at, last_visit_at, last_active_at, tour_completed_at, plan_selected_at, password_set_at"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      admin.auth.admin.getUserById(userId),
      admin
        .from("subscriptions")
        .select("plan, status")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("saved_emails")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      admin
        .from("collections")
        .select("name, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
      admin.from("brand_follows").select("company_id").eq("user_id", userId),
      admin
        .from("competitor_sets")
        .select("name, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
      admin
        .from("upgrade_clicks")
        .select("source, path, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("nav_clicks")
        .select("nav_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(2000)
    ]);

    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const profile = profileRes.data;

    // Followed brand names (best-effort; the popout just lists them).
    let followedBrands: string[] = [];
    const companyIds = (followsRes.data ?? []).map((f) => f.company_id);
    if (companyIds.length > 0) {
      const { data: companies } = await admin
        .from("companies")
        .select("name")
        .in("id", companyIds);
      followedBrands = (companies ?? []).map((c) => c.name).sort();
    }

    const sub = subRes.data;
    const live = sub?.status === "active" || sub?.status === "trialing";
    const tier: SignupTier =
      live && (sub?.plan === "solo" || sub?.plan === "team")
        ? sub.plan
        : "free";

    const authUser = authRes.data?.user ?? null;
    const provider =
      typeof authUser?.app_metadata?.provider === "string"
        ? authUser.app_metadata.provider
        : null;

    // Per-button totals, ordered by most clicked.
    const navByButton = new Map<string, { count: number; lastAt: string }>();
    for (const row of navRes.data ?? []) {
      const cur = navByButton.get(row.nav_id);
      if (cur) {
        cur.count += 1;
        if (row.created_at > cur.lastAt) cur.lastAt = row.created_at;
      } else {
        navByButton.set(row.nav_id, { count: 1, lastAt: row.created_at });
      }
    }
    const navClicks = Array.from(navByButton.entries())
      .map(([navId, v]) => ({
        navId,
        label: labelForNavId(navId),
        count: v.count,
        lastAt: v.lastAt
      }))
      .sort((a, b) => b.count - a.count);

    const upgradeRows = upgradesRes.data ?? [];
    const activity: UserActivity = {
      profile: {
        email: profile.email,
        name: profile.full_name,
        createdAt: profile.created_at,
        lastVisitAt: profile.last_visit_at,
        lastActiveAt: profile.last_active_at,
        tourCompletedAt: profile.tour_completed_at,
        planSelectedAt: profile.plan_selected_at,
        passwordSetAt: profile.password_set_at
      },
      auth: {
        provider,
        lastSignInAt: authUser?.last_sign_in_at ?? null
      },
      tier,
      savedCount: savedRes.count ?? 0,
      collections: (collectionsRes.data ?? []).map((c) => ({
        name: c.name,
        createdAt: c.created_at
      })),
      followedBrands,
      competitorSets: (setsRes.data ?? []).map((s) => ({
        name: s.name,
        createdAt: s.created_at
      })),
      upgradeClicks: {
        total: upgradeRows.length,
        recent: upgradeRows.slice(0, LIST_LIMIT).map((u) => ({
          label: labelForUpgradeSource(u.source),
          path: u.path,
          createdAt: u.created_at
        }))
      },
      navClicks
    };

    return NextResponse.json({ activity });
  } catch (error) {
    console.error("Failed to load user activity", error);
    return NextResponse.json(
      { error: "Failed to load user activity" },
      { status: 500 }
    );
  }
}
