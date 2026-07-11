import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { saveYourBrandPrefs } from "@/lib/your-brand-db";

/**
 * `PUT /api/your-brand/prefs` — persist the viewer's "Your brand" tab
 * state: which insights they've hidden and which saved comparison powers
 * the peer-based rules. Paid-only, matching the page itself. The body is
 * sanitized server-side so a stale or hand-rolled payload can never store
 * unknown insight ids.
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
    const saved = await saveYourBrandPrefs(
      session.supabase,
      session.user.id,
      body
    );
    return NextResponse.json({ ok: true, prefs: saved });
  } catch (error) {
    console.error("Failed to save your-brand prefs", error);
    return NextResponse.json(
      { error: "Failed to save preferences" },
      { status: 500 }
    );
  }
}
