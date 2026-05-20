import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { saveEmail, unsaveEmail } from "@/lib/saved-emails-db";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ emailId: string }> };

/**
 * `PUT /api/explore/saved/[emailId]` — idempotent save (the Explore
 * card's Save button uses this).
 */
export async function PUT(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { emailId } = await context.params;
  if (!UUID_PATTERN.test(emailId)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  try {
    await saveEmail(session.supabase, session.user.id, emailId);
    return NextResponse.json({ ok: true, saved: true });
  } catch (error) {
    console.error("Failed to save email", error);
    return NextResponse.json(
      { error: "Failed to save email" },
      { status: 500 }
    );
  }
}

/**
 * `DELETE /api/explore/saved/[emailId]` — remove the bookmark.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { emailId } = await context.params;
  if (!UUID_PATTERN.test(emailId)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  try {
    await unsaveEmail(session.supabase, session.user.id, emailId);
    return NextResponse.json({ ok: true, saved: false });
  } catch (error) {
    console.error("Failed to unsave email", error);
    return NextResponse.json(
      { error: "Failed to unsave email" },
      { status: 500 }
    );
  }
}
