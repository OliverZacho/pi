import { NextResponse } from "next/server";
import { getCollectionBySlugPublic } from "@/lib/collections-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const SLUG_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * GET `/api/c/[slug]` — public payload for a shared collection.
 *
 * This route is intentionally **unauthenticated**: the slug is the
 * shared secret and `getCollectionBySlugPublic` runs under the
 * service-role client so it bypasses RLS. We still check the slug
 * shape so a typo can't hit the database.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const detail = await getCollectionBySlugPublic(admin, slug);
    if (!detail) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ collection: detail });
  } catch (error) {
    console.error("Failed to load public collection", error);
    return NextResponse.json(
      { error: "Failed to load collection" },
      { status: 500 }
    );
  }
}
