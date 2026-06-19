import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { removeBrandFromSet, setMemberInboxes } from "@/lib/competitor-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = {
  params: Promise<{ id: string; companyId: string }>;
};

/**
 * DELETE `/api/competitor-sets/[id]/brands/[companyId]` — owner-only
 * removal. Idempotent: returns `ok` whether or not the row existed,
 * unless the set itself doesn't belong to the caller.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id, companyId } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(companyId)) {
    return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
  }

  try {
    const result = await removeBrandFromSet(
      session.supabase,
      session.user.id,
      id,
      companyId
    );
    if (result === "missing") {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to remove brand from competitor set", error);
    return NextResponse.json(
      { error: "Failed to remove brand" },
      { status: 500 }
    );
  }
}

/**
 * PATCH `/api/competitor-sets/[id]/brands/[companyId]` `{ inboxIds }` —
 * re-scope the brand to a subset of its mailing lists, or back to all lists
 * with an empty array. Owner-only.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id, companyId } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(companyId)) {
    return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawInboxIds =
    body && typeof body === "object" && "inboxIds" in body
      ? (body as { inboxIds: unknown }).inboxIds
      : [];
  if (!Array.isArray(rawInboxIds)) {
    return NextResponse.json(
      { error: "inboxIds must be an array" },
      { status: 400 }
    );
  }
  // Keep only well-formed UUIDs; an empty result means "all lists".
  const inboxIds = Array.from(
    new Set(
      rawInboxIds.filter(
        (v): v is string => typeof v === "string" && UUID_PATTERN.test(v)
      )
    )
  );

  try {
    const result = await setMemberInboxes(
      session.supabase,
      session.user.id,
      id,
      companyId,
      inboxIds
    );
    if (result === "missing") {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update brand list scope", error);
    return NextResponse.json(
      { error: "Failed to update list" },
      { status: 500 }
    );
  }
}
