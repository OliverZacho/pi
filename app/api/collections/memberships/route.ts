import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { listCollectionMembership } from "@/lib/collections-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * GET `/api/collections/memberships?emailId=<uuid>`
 *
 * Returns `{ collectionIds: string[] }` — the set of collections owned
 * by the current user that already contain `emailId`. The "Add to
 * collection" popover calls this on open so it can pre-check the right
 * rows without needing to fetch every membership at page-load time.
 */
export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const emailId = url.searchParams.get("emailId");
  if (!emailId || !UUID_PATTERN.test(emailId)) {
    return NextResponse.json({ error: "Invalid emailId" }, { status: 400 });
  }

  try {
    const collectionIds = await listCollectionMembership(
      session.supabase,
      session.user.id,
      emailId
    );
    return NextResponse.json({ collectionIds });
  } catch (error) {
    console.error("Failed to load collection memberships", error);
    return NextResponse.json(
      { error: "Failed to load collection memberships" },
      { status: 500 }
    );
  }
}
