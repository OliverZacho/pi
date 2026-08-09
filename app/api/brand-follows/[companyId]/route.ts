import { NextResponse } from "next/server";
import { FREE_FOLLOW_LIMIT } from "@/lib/access";
import { freeQuotaDecision } from "@/lib/free-quota";
import { requireSessionWithEntitlement } from "@/lib/require-admin-api";
import {
  countFollows,
  followBrand,
  isBrandFollowed,
  isValidCompanyId,
  unfollowBrand
} from "@/lib/follows-db";

type RouteContext = { params: Promise<{ companyId: string }> };

/**
 * Following is open to any signed-in user, but entitlement decides how:
 *  - Paid / admin (has_archive_access): unrestricted, via their own
 *    session client (RLS scopes the row).
 *  - Free: the service-role client performs the operation and the route
 *    enforces the only free-tier rule — the FREE_FOLLOW_LIMIT cap. Free
 *    session tokens have no RLS grant on brand_follows, so the cap
 *    can't be bypassed via direct PostgREST.
 */

/**
 * `GET /api/brand-follows/[companyId]` — point-check whether the current
 * user follows this brand. The email modal's Follow toggle calls this on
 * open to seed its state (the brand page already knows server-side).
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionWithEntitlement();
  if ("response" in session) {
    return session.response;
  }

  const { companyId } = await context.params;
  if (!isValidCompanyId(companyId)) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  try {
    const following = await isBrandFollowed(
      session.client,
      session.user.id,
      companyId
    );
    return NextResponse.json({ following });
  } catch (error) {
    console.error("Failed to check brand follow", error);
    return NextResponse.json(
      { error: "Failed to check brand follow" },
      { status: 500 }
    );
  }
}

/**
 * `PUT /api/brand-follows/[companyId]` — idempotent follow. The brand
 * page's "Follow" toggle uses this.
 */
export async function PUT(_request: Request, context: RouteContext) {
  const session = await requireSessionWithEntitlement();
  if ("response" in session) {
    return session.response;
  }

  const { companyId } = await context.params;
  if (!isValidCompanyId(companyId)) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  try {
    if (!session.hasAccess) {
      const [alreadyFollowed, count] = await Promise.all([
        isBrandFollowed(session.client, session.user.id, companyId),
        countFollows(session.client, session.user.id)
      ]);
      const decision = freeQuotaDecision({
        alreadyPresent: alreadyFollowed,
        count,
        limit: FREE_FOLLOW_LIMIT,
        code: "FOLLOW_LIMIT_REACHED",
        error: `Free accounts can follow up to ${FREE_FOLLOW_LIMIT} brands. Upgrade to follow more.`
      });
      if (!decision.ok) {
        return NextResponse.json(
          { error: decision.error, code: decision.code },
          { status: decision.status }
        );
      }
    }

    await followBrand(session.client, session.user.id, companyId);
    return NextResponse.json({ ok: true, following: true });
  } catch (error) {
    console.error("Failed to follow brand", error);
    return NextResponse.json(
      { error: "Failed to follow brand" },
      { status: 500 }
    );
  }
}

/**
 * `DELETE /api/brand-follows/[companyId]` — remove the follow. Always
 * allowed for any signed-in user (frees a slot under the cap).
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSessionWithEntitlement();
  if ("response" in session) {
    return session.response;
  }

  const { companyId } = await context.params;
  if (!isValidCompanyId(companyId)) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  try {
    await unfollowBrand(session.client, session.user.id, companyId);
    return NextResponse.json({ ok: true, following: false });
  } catch (error) {
    console.error("Failed to unfollow brand", error);
    return NextResponse.json(
      { error: "Failed to unfollow brand" },
      { status: 500 }
    );
  }
}
