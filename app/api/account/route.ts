import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { handleOwnerDeparture } from "@/lib/teams-db";

/**
 * DELETE `/api/account` `{ confirmation }` — hard-deletes the caller's
 * account. `confirmation` must equal their email (the dialog makes them
 * type it). Every user-owned table FKs `auth.users` with on-delete
 * cascade, so `deleteUser` cleans up the data; team ownership is resolved
 * first so a team isn't left ownerless.
 *
 * The caller's JWT stays locally-verifiable until it expires (getClaims
 * is offline), but cookies are cleared here and all rows are gone, so a
 * stale token can no longer reach anything.
 */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const confirmation =
    body && typeof body === "object" && "confirmation" in body
      ? (body as { confirmation: unknown }).confirmation
      : undefined;

  const email = session.user.email ?? "";
  if (
    typeof confirmation !== "string" ||
    !email ||
    confirmation.trim().toLowerCase() !== email.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Type your email to confirm deletion" },
      { status: 400 }
    );
  }

  try {
    const admin = getSupabaseAdmin();

    await handleOwnerDeparture(admin, session.user.id);

    const { error: deleteError } = await admin.auth.admin.deleteUser(
      session.user.id
    );
    if (deleteError) {
      console.error("Failed to delete account", deleteError);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 }
      );
    }

    // Clear the session cookies in this response.
    await session.supabase.auth.signOut();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete account", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}
