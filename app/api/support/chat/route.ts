import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";

const MAX_MESSAGE_LENGTH = 4000;

type ChatMessage = {
  id: string;
  sender: "user" | "admin";
  body: string;
  created_at: string;
};

/**
 * GET `/api/support/chat` — the signed-in user's support chat thread.
 *
 * Returns `{ thread, messages, unreadCount }`. `?summary=1` returns only
 * `{ unreadCount, lastMessageAt }` for the cheap notification-dot poll.
 * Reading does NOT clear unread — the client calls `/api/support/chat/read`
 * when the panel is actually open so the dot only clears once seen.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { data: thread, error } = await session.supabase
    .from("support_chat_threads")
    .select("id, status, last_message_at, last_message_sender, user_unread_count")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load support chat thread", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const summary = new URL(request.url).searchParams.get("summary") === "1";
  if (summary || !thread) {
    return NextResponse.json({
      unreadCount: thread?.user_unread_count ?? 0,
      lastMessageAt: thread?.last_message_at ?? null,
      ...(summary ? {} : { thread: thread ?? null, messages: [] })
    });
  }

  const { data: messages, error: messagesError } = await session.supabase
    .from("support_chat_messages")
    .select("id, sender, body, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    console.error("Failed to load support chat messages", messagesError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({
    thread,
    messages: (messages ?? []) as ChatMessage[],
    unreadCount: thread.user_unread_count
  });
}

/**
 * POST `/api/support/chat` — the user sends a message. Lazily creates the
 * thread on first send. The DB trigger bumps the thread's activity + the
 * admin's unread counter.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
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
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message is too long." }, { status: 400 });
  }

  // Find or lazily create the user's single thread.
  let threadId: string | null = null;
  const { data: existing } = await session.supabase
    .from("support_chat_threads")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (existing) {
    threadId = existing.id;
  } else {
    const { data: created, error: createError } = await session.supabase
      .from("support_chat_threads")
      .upsert(
        { user_id: session.user.id, user_email: session.user.email },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();
    if (createError || !created) {
      console.error("Failed to create support chat thread", createError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    threadId = created.id;
  }

  const { data: inserted, error: insertError } = await session.supabase
    .from("support_chat_messages")
    .insert({ thread_id: threadId, sender: "user", body: message })
    .select("id, sender, body, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("Failed to insert support chat message", insertError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ message: inserted as ChatMessage });
}
