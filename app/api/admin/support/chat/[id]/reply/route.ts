import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_REPLY_LENGTH = 4000;

/**
 * POST `/api/admin/support/chat/:id/reply` — an admin posts a message into the
 * user's chat thread. The DB trigger bumps the user's unread counter so their
 * "Need help?" dot lights up; no email is sent (in-app delivery only).
 */
export async function POST(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message =
    typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message.trim()
      : "";

  if (!message) {
    return NextResponse.json({ error: "Reply message is required." }, { status: 400 });
  }
  if (message.length > MAX_REPLY_LENGTH) {
    return NextResponse.json({ error: "Reply is too long." }, { status: 400 });
  }

  const { data: thread, error: loadError } = await session.supabase
    .from("support_chat_threads")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("Failed to load support chat thread for reply", loadError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const { data: inserted, error: insertError } = await session.supabase
    .from("support_chat_messages")
    .insert({
      thread_id: id,
      sender: "admin",
      body: message,
      sent_by: session.user.id,
      sent_by_email: session.user.email
    })
    .select("id, sender, body, sent_by_email, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("Failed to insert admin chat reply", insertError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ message: inserted });
}
