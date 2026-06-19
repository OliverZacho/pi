import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import {
  createCompetitorSet,
  parseMemberInputs,
  listCompetitorSetSummaries,
  MAX_BRANDS_PER_COMPARISON
} from "@/lib/competitor-db";

const MAX_NAME_LENGTH = 120;

/**
 * GET `/api/competitor-sets` — every set the current user owns, sorted
 * most-recently-updated first. Used by the sidebar to render the
 * "Your competitors" section without a per-page server round-trip.
 */
export async function GET() {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  try {
    const items = await listCompetitorSetSummaries(
      session.supabase,
      session.user.id
    );
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to list competitor sets", error);
    return NextResponse.json(
      { error: "Failed to list competitor sets" },
      { status: 500 }
    );
  }
}

/**
 * POST `/api/competitor-sets` `{ name, brandIds? }` — create a new set
 * with an optional initial member list. The DB enforces uniqueness on
 * `(set_id, company_id)`; bad brand ids are dropped at validation time.
 */
export async function POST(request: Request) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawName =
    body && typeof body === "object" && "name" in body
      ? (body as { name: unknown }).name
      : undefined;

  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (rawName.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  // Accepts `{ members: [{ companyId, inboxId }] }` (list-scoped) or the
  // legacy `{ brandIds: string[] }` (all-lists).
  const members = parseMemberInputs(body);

  if (members.length > MAX_BRANDS_PER_COMPARISON) {
    return NextResponse.json(
      {
        error: `A set can contain at most ${MAX_BRANDS_PER_COMPARISON} brands`
      },
      { status: 400 }
    );
  }

  try {
    const detail = await createCompetitorSet(session.supabase, session.user.id, {
      name: rawName,
      members
    });
    return NextResponse.json({ set: detail }, { status: 201 });
  } catch (error) {
    console.error("Failed to create competitor set", error);
    return NextResponse.json(
      { error: "Failed to create competitor set" },
      { status: 500 }
    );
  }
}
