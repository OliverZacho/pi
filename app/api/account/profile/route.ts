import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { MAX_FULL_NAME_LENGTH, updateFullName } from "@/lib/profile-db";

/**
 * PATCH `/api/account/profile` `{ fullName }` — updates the caller's
 * display name on the Settings User tab. Open to any signed-in user
 * (settings is not entitlement-gated).
 */
export async function PATCH(request: Request) {
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

  const rawFullName =
    body && typeof body === "object" && "fullName" in body
      ? (body as { fullName: unknown }).fullName
      : undefined;

  if (typeof rawFullName !== "string" || rawFullName.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (rawFullName.trim().length > MAX_FULL_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be ${MAX_FULL_NAME_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  try {
    const profile = await updateFullName(
      session.supabase,
      session.user.id,
      rawFullName
    );
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Failed to update profile", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
