import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import {
  deleteCollection,
  getCollectionForOwner,
  renameCollection
} from "@/lib/collections-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const MAX_NAME_LENGTH = 120;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET `/api/collections/[id]` — owner-side detail: the collection meta
 * plus every email currently in it. Powers `/collections/[id]`.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
  }

  try {
    const detail = await getCollectionForOwner(
      session.supabase,
      session.user.id,
      id
    );
    if (!detail) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ collection: detail });
  } catch (error) {
    console.error("Failed to load collection", error);
    return NextResponse.json(
      { error: "Failed to load collection" },
      { status: 500 }
    );
  }
}

/**
 * PATCH `/api/collections/[id]` `{ name }` — owner-only rename.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
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
    const updated = await renameCollection(
      session.supabase,
      session.user.id,
      id,
      rawName
    );
    if (!updated) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ collection: updated });
  } catch (error) {
    console.error("Failed to rename collection", error);
    return NextResponse.json(
      { error: "Failed to rename collection" },
      { status: 500 }
    );
  }
}

/**
 * DELETE `/api/collections/[id]` — owner-only delete. The DB
 * cascades the `collection_emails` rows for free.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
  }

  try {
    const removed = await deleteCollection(
      session.supabase,
      session.user.id,
      id
    );
    if (!removed) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete collection", error);
    return NextResponse.json(
      { error: "Failed to delete collection" },
      { status: 500 }
    );
  }
}
