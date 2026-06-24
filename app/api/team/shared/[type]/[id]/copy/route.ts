import { NextResponse } from "next/server";
import { copySharedCollection } from "@/lib/collections-db";
import { copySharedSet } from "@/lib/competitor-db";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getTeamMembership } from "@/lib/teams-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ type: string; id: string }> };

/**
 * POST `/api/team/shared/[type]/[id]/copy` — deep-copy a team-shared
 * collection or comparison into the caller's own account.
 *
 * Only `requireSession` (not archive access): a lapsed member must be able
 * to copy items before they lose the team plan. Authorization is by team
 * co-membership — the source must be shared_with_team and owned by someone
 * on the caller's team. The copy itself runs via the admin client so it
 * works even when the recipient has lost archive access.
 */
export async function POST(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { type, id } = await context.params;
  if (type !== "collection" && type !== "comparison") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const membership = await getTeamMembership(admin, session.user.id);
    if (!membership) {
      return NextResponse.json({ error: "You're not on a team" }, { status: 403 });
    }

    // The source must be shared and owned by a co-member of the caller.
    if (type === "collection") {
      const { data: src } = await admin
        .from("collections")
        .select("user_id, shared_with_team")
        .eq("id", id)
        .maybeSingle();
      if (
        !src ||
        !src.shared_with_team ||
        !membership.memberIds.includes(src.user_id)
      ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const copied = await copySharedCollection(admin, id, session.user.id);
      if (!copied) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({
        id: copied.id,
        name: copied.name,
        href: `/collections/${copied.id}`
      });
    }

    const { data: src } = await admin
      .from("competitor_sets")
      .select("user_id, shared_with_team")
      .eq("id", id)
      .maybeSingle();
    if (
      !src ||
      !src.shared_with_team ||
      !membership.memberIds.includes(src.user_id)
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const copied = await copySharedSet(admin, id, session.user.id);
    if (!copied) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: copied.id,
      name: copied.name,
      href: `/compare/${copied.id}`
    });
  } catch (error) {
    console.error("Failed to copy shared item", error);
    return NextResponse.json({ error: "Failed to copy" }, { status: 500 });
  }
}
