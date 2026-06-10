import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import {
  deleteCompetitorSet,
  getCompetitorSetForOwner,
  renameCompetitorSet
} from "@/lib/competitor-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const MAX_NAME_LENGTH = 120;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET `/api/competitor-sets/[id]` — owner-side detail: set meta + every
 * brand currently in it (with signed logo URLs).
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }

  try {
    const detail = await getCompetitorSetForOwner(
      session.supabase,
      session.user.id,
      id
    );
    if (!detail) {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ set: detail });
  } catch (error) {
    console.error("Failed to load competitor set", error);
    return NextResponse.json(
      { error: "Failed to load competitor set" },
      { status: 500 }
    );
  }
}

/**
 * PATCH `/api/competitor-sets/[id]` `{ name }` — owner-only rename.
 */
export async function PATCH(request: Request, context: RouteContext) {
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

  try {
    const updated = await renameCompetitorSet(
      session.supabase,
      session.user.id,
      id,
      rawName
    );
    if (!updated) {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ set: updated });
  } catch (error) {
    console.error("Failed to rename competitor set", error);
    return NextResponse.json(
      { error: "Failed to rename competitor set" },
      { status: 500 }
    );
  }
}

/**
 * DELETE `/api/competitor-sets/[id]` — owner-only delete. The DB
 * cascades `competitor_set_members` for free.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }

  try {
    const removed = await deleteCompetitorSet(
      session.supabase,
      session.user.id,
      id
    );
    if (!removed) {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete competitor set", error);
    return NextResponse.json(
      { error: "Failed to delete competitor set" },
      { status: 500 }
    );
  }
}
