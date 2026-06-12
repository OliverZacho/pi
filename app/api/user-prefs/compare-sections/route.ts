import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { saveCompareSectionPrefs } from "@/lib/user-prefs-db";

/**
 * `PUT /api/user-prefs/compare-sections` — persist the user's
 * comparison-dashboard layout (section order + hidden sections).
 * The body is sanitized server-side, so a stale or hand-rolled client
 * payload can never store unknown section ids.
 */
export async function PUT(request: Request) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const saved = await saveCompareSectionPrefs(
      session.supabase,
      session.user.id,
      body
    );
    return NextResponse.json({ ok: true, prefs: saved });
  } catch (error) {
    console.error("Failed to save compare section prefs", error);
    return NextResponse.json(
      { error: "Failed to save preferences" },
      { status: 500 }
    );
  }
}
