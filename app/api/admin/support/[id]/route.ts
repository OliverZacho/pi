import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_STATUSES = new Set(["unread", "read", "archived"]);

/**
 * GET `/api/admin/support/:id` — full message (incl. body + sent replies).
 * Opening an unread message marks it read as a side effect.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing message id" }, { status: 400 });
  }

  const { data: email, error } = await session.supabase
    .from("support_emails")
    .select(
      "id, from_address, from_name, to_address, subject, plain_text, html, received_at, status, replied_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load support email", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!email) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const { data: replies, error: repliesError } = await session.supabase
    .from("support_email_replies")
    .select("id, body, sent_by_email, resend_message_id, created_at")
    .eq("support_email_id", id)
    .order("created_at", { ascending: true });

  if (repliesError) {
    console.error("Failed to load support replies", repliesError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  let status = email.status;
  if (status === "unread") {
    const { error: markError } = await session.supabase
      .from("support_emails")
      .update({ status: "read" })
      .eq("id", id)
      .eq("status", "unread");
    if (!markError) {
      status = "read";
    }
  }

  return NextResponse.json({
    email: { ...email, status },
    replies: replies ?? []
  });
}

/**
 * PATCH `/api/admin/support/:id` — update status (read / unread / archived).
 */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing message id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = (body as { status?: unknown }).status;
  if (typeof status !== "string" || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { data: updated, error } = await session.supabase
    .from("support_emails")
    .update({ status })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("Failed to update support email status", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  return NextResponse.json({ email: updated });
}
