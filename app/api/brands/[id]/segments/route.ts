import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { getBrandSegments } from "@/lib/brand-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET `/api/brands/[id]/segments` — the brand's tagged mailing lists, used
 * by the comparison pickers to let the user scope a multi-list brand to one
 * list before (or after) adding it. Returns `[]` for single-list brands, so
 * the UI simply shows no list choice for them.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  try {
    const segments = await getBrandSegments(session.supabase, id);
    return NextResponse.json({ segments });
  } catch (error) {
    console.error("Failed to load brand segments", error);
    return NextResponse.json(
      { error: "Failed to load segments" },
      { status: 500 }
    );
  }
}
