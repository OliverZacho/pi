import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import {
  createCollection,
  listCollectionsWithPreviews
} from "@/lib/collections-db";
import { isCollectionIcon } from "@/lib/collection-icons";

/**
 * GET `/api/collections` — every collection the current user owns,
 * each with up to four preview email ids and a count. Powers both the
 * grid page (`/collections`) and any client that needs a richer
 * payload than the sidebar list.
 */
export async function GET() {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  try {
    const items = await listCollectionsWithPreviews(
      session.supabase,
      session.user.id
    );
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to list collections", error);
    return NextResponse.json(
      { error: "Failed to list collections" },
      { status: 500 }
    );
  }
}

const MAX_NAME_LENGTH = 120;

/**
 * POST `/api/collections` `{ name }` — creates a new collection owned
 * by the caller. The share slug is generated server-side so the client
 * can't pick a predictable URL.
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

  // `icon` is optional. Reject any value that isn't in the curated
  // allow-list, but treat an absent / null icon as "no custom icon".
  const rawIcon =
    body && typeof body === "object" && "icon" in body
      ? (body as { icon: unknown }).icon
      : undefined;
  if (rawIcon !== undefined && rawIcon !== null && !isCollectionIcon(rawIcon)) {
    return NextResponse.json(
      { error: "Unsupported collection icon" },
      { status: 400 }
    );
  }

  try {
    const collection = await createCollection(
      session.supabase,
      session.user.id,
      rawName,
      isCollectionIcon(rawIcon) ? rawIcon : null
    );
    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    console.error("Failed to create collection", error);
    return NextResponse.json(
      { error: "Failed to create collection" },
      { status: 500 }
    );
  }
}
