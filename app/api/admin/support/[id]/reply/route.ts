import { NextResponse } from "next/server";
import { replyFromForInbox } from "@/lib/docs/support";
import { requireAdminSession } from "@/lib/require-admin-api";
import { getResend } from "@/lib/resend";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_REPLY_LENGTH = 10000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * POST `/api/admin/support/:id/reply` — sends an admin reply to the original
 * sender via Resend, records it on the thread, and marks the message replied.
 */
export async function POST(request: Request, context: RouteContext) {
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

  const message =
    typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message.trim()
      : "";

  if (!message) {
    return NextResponse.json({ error: "Reply message is required." }, { status: 400 });
  }
  if (message.length > MAX_REPLY_LENGTH) {
    return NextResponse.json({ error: "Reply is too long." }, { status: 400 });
  }

  const { data: email, error: loadError } = await session.supabase
    .from("support_emails")
    .select("id, from_address, to_address, subject")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("Failed to load support email for reply", loadError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!email) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const replySubject = email.subject.toLowerCase().startsWith("re:")
    ? email.subject
    : `Re: ${email.subject}`;

  let resendMessageId: string | null = null;
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: replyFromForInbox(email.to_address),
      to: email.from_address,
      subject: replySubject,
      text: message,
      html: `<p>${escapeHtml(message).replace(/\n/g, "<br />")}</p>`
    });

    if (error || !data) {
      console.error("Resend failed to send support reply", error);
      return NextResponse.json(
        { error: "We couldn't send the reply right now. Please try again." },
        { status: 502 }
      );
    }
    resendMessageId = data.id;
  } catch (err) {
    console.error("Support reply send failed", err);
    return NextResponse.json(
      { error: "We couldn't send the reply right now. Please try again." },
      { status: 500 }
    );
  }

  const { data: reply, error: insertError } = await session.supabase
    .from("support_email_replies")
    .insert({
      support_email_id: id,
      body: message,
      sent_by: session.user.id,
      sent_by_email: session.user.email,
      resend_message_id: resendMessageId
    })
    .select("id, body, sent_by_email, resend_message_id, created_at")
    .single();

  if (insertError || !reply) {
    // The email already went out; surface the failure but don't 500 the send.
    console.error("Reply sent but failed to record", insertError);
    return NextResponse.json(
      { error: "Reply sent, but it couldn't be saved to the thread." },
      { status: 500 }
    );
  }

  await session.supabase
    .from("support_emails")
    .update({ status: "read", replied_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ reply });
}
