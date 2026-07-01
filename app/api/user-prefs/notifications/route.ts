import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import {
  getNotificationPrefs,
  saveNotificationPrefs
} from "@/lib/notification-prefs-db";

/**
 * Notification preferences (Settings → Notifications).
 *
 * Gated by login only, not by entitlement: any signed-in user can store
 * their preferences, mirroring the rest of the Settings surface. Whether
 * a digest is actually sent is gated independently by the digest job,
 * which only includes entitled subscribers — so an unpaid user can pick
 * "weekly" without it doing anything until they upgrade.
 */

export async function GET() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const prefs = await getNotificationPrefs(session.supabase, session.user.id);
  return NextResponse.json({ prefs });
}

export async function PUT(request: Request) {
  const session = await requireSession();
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
    const saved = await saveNotificationPrefs(
      session.supabase,
      session.user.id,
      body
    );
    return NextResponse.json({ ok: true, prefs: saved });
  } catch (error) {
    console.error("Failed to save notification prefs", error);
    return NextResponse.json(
      { error: "Failed to save preferences" },
      { status: 500 }
    );
  }
}
