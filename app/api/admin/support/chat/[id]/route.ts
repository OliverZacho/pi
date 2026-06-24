import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_STATUSES = new Set(["open", "archived"]);

/**
 * GET `/api/admin/support/chat/:id` — full chat thread + messages. Opening a
 * thread clears the admin's unread counter for it as a side effect.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
  }

  const { data: thread, error } = await session.supabase
    .from("support_chat_threads")
    .select(
      "id, user_id, user_email, status, last_message_at, last_message_sender, user_unread_count, admin_unread_count, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load support chat thread", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const { data: messages, error: messagesError } = await session.supabase
    .from("support_chat_messages")
    .select("id, sender, body, sent_by_email, created_at")
    .eq("thread_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    console.error("Failed to load support chat messages", messagesError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (thread.admin_unread_count > 0) {
    await session.supabase
      .from("support_chat_threads")
      .update({ admin_unread_count: 0 })
      .eq("id", id);
    thread.admin_unread_count = 0;
  }

  return NextResponse.json({ thread, messages: messages ?? [] });
}

/**
 * PATCH `/api/admin/support/chat/:id` — update a thread's status
 * (open / archived). Archiving = "resolved"; a new user message re-opens it.
 */
export async function PATCH(request: Request, context: RouteContext) {
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

  const status = (payload as { status?: unknown }).status;
  if (typeof status !== "string" || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { data: updated, error } = await session.supabase
    .from("support_chat_threads")
    .update({ status })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("Failed to update chat thread status", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ thread: updated });
}
