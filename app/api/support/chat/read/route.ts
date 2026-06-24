import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";

/**
 * POST `/api/support/chat/read` — clears the user's unread counter once they've
 * actually viewed the chat panel (admin replies marked as seen).
 */
export async function POST() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { error } = await session.supabase
    .from("support_chat_threads")
    .update({ user_unread_count: 0 })
    .eq("user_id", session.user.id);

  if (error) {
    console.error("Failed to mark support chat read", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
