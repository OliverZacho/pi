import { NextResponse } from "next/server";
import { copySharedCollection } from "@/lib/collections-db";
import { copySharedSet } from "@/lib/competitor-db";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getTeamMembership } from "@/lib/teams-db";

/**
 * POST `/api/team/shared/copy-all` — copy every collection & comparison
 * teammates have shared with the caller's team into the caller's account.
 *
 * Used by the team-inactive interstitial and the leave-team flow so a
 * departing or lapsed member can keep a private copy of shared work.
 * Session-only (no archive gate) + admin-client copies, so it works for a
 * member whose team plan has already lapsed.
 */
export async function POST() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const admin = getSupabaseAdmin();
    const membership = await getTeamMembership(admin, session.user.id);
    if (!membership) {
      return NextResponse.json({ copied: 0 });
    }

    const otherIds = membership.memberIds.filter(
      (uid) => uid !== session.user.id
    );
    if (otherIds.length === 0) {
      return NextResponse.json({ copied: 0 });
    }

    const [{ data: cols }, { data: sets }] = await Promise.all([
      admin
        .from("collections")
        .select("id")
        .eq("shared_with_team", true)
        .in("user_id", otherIds),
      admin
        .from("competitor_sets")
        .select("id")
        .eq("shared_with_team", true)
        .in("user_id", otherIds)
    ]);

    let copied = 0;
    for (const c of cols ?? []) {
      const result = await copySharedCollection(admin, c.id, session.user.id);
      if (result) copied++;
    }
    for (const s of sets ?? []) {
      const result = await copySharedSet(admin, s.id, session.user.id);
      if (result) copied++;
    }

    return NextResponse.json({ copied });
  } catch (error) {
    console.error("Failed to copy shared items", error);
    return NextResponse.json({ error: "Failed to copy" }, { status: 500 });
  }
}
