import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import {
  followBrand,
  isValidCompanyId,
  unfollowBrand
} from "@/lib/follows-db";

type RouteContext = { params: Promise<{ companyId: string }> };

/**
 * `PUT /api/brand-follows/[companyId]` — idempotent follow. The brand
 * page's "Follow" toggle uses this.
 */
export async function PUT(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { companyId } = await context.params;
  if (!isValidCompanyId(companyId)) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  try {
    await followBrand(session.supabase, session.user.id, companyId);
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
 * `DELETE /api/brand-follows/[companyId]` — remove the follow.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { companyId } = await context.params;
  if (!isValidCompanyId(companyId)) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  try {
    await unfollowBrand(session.supabase, session.user.id, companyId);
    return NextResponse.json({ ok: true, following: false });
  } catch (error) {
    console.error("Failed to unfollow brand", error);
    return NextResponse.json(
      { error: "Failed to unfollow brand" },
      { status: 500 }
    );
  }
}
