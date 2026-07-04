import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import {
  addBrandsToSet,
  parseMemberInputs,
  MAX_BRANDS_PER_COMPARISON
} from "@/lib/competitor-db";
import { competitorSetWriteFailure } from "@/lib/competitor-set-api";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST `/api/competitor-sets/[id]/brands` `{ brandIds: string[] }` —
 * idempotent bulk add. Returns the full updated brand list so the
 * client can replace its local state in one go.
 */
export async function POST(request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Accepts either `{ members: [{ companyId, inboxId }] }` (list-scoped) or
  // the legacy `{ brandIds: string[] }` (all-lists). `parseMemberInputs`
  // normalises both shapes and drops anything malformed.
  const members = parseMemberInputs(body);

  try {
    const result = await addBrandsToSet(
      session.supabase,
      session.user.id,
      id,
      members
    );
    if (result.status === "missing") {
      return competitorSetWriteFailure(session.supabase, id);
    }
    if (result.status === "full") {
      return NextResponse.json(
        {
          error: `A set can contain at most ${MAX_BRANDS_PER_COMPARISON} brands`
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      brands: result.brands,
      addedCount: result.addedCount
    });
  } catch (error) {
    console.error("Failed to add brands to competitor set", error);
    return NextResponse.json(
      { error: "Failed to add brands" },
      { status: 500 }
    );
  }
}
