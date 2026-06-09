import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { listFollowedBrands } from "@/lib/follows-db";

/**
 * GET `/api/brand-follows` — every brand the current user follows,
 * ordered most-recently-followed first. Used by the "Following"
 * sidebar / page so it can render without a per-page server round
 * trip.
 */
export async function GET() {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  try {
    const items = await listFollowedBrands(session.supabase, session.user.id);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to list followed brands", error);
    return NextResponse.json(
      { error: "Failed to list followed brands" },
      { status: 500 }
    );
  }
}
