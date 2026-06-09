import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import {
  addEmailToCollection,
  removeEmailFromCollection
} from "@/lib/collections-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ id: string; emailId: string }> };

/**
 * PUT `/api/collections/[id]/emails/[emailId]` — idempotent membership
 * add. The "Add to collection" popover on every Explore card hits this
 * endpoint when the user checks a row.
 */
export async function PUT(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id, emailId } = await context.params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(emailId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const result = await addEmailToCollection(
      session.supabase,
      session.user.id,
      id,
      emailId
    );
    if (result === "missing") {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, inCollection: true });
  } catch (error) {
    console.error("Failed to add email to collection", error);
    return NextResponse.json(
      { error: "Failed to add email to collection" },
      { status: 500 }
    );
  }
}

/**
 * DELETE `/api/collections/[id]/emails/[emailId]` — remove the email
 * from this collection. Idempotent: no row to delete is still a 200.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id, emailId } = await context.params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(emailId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const ok = await removeEmailFromCollection(
      session.supabase,
      session.user.id,
      id,
      emailId
    );
    if (!ok) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, inCollection: false });
  } catch (error) {
    console.error("Failed to remove email from collection", error);
    return NextResponse.json(
      { error: "Failed to remove email from collection" },
      { status: 500 }
    );
  }
}
