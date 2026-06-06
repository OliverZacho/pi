import { NextResponse } from "next/server";
import { getResend } from "@/lib/resend";
import { CONTACT_FROM, CONTACT_INBOX } from "@/lib/docs/support";

const MAX_MESSAGE_LENGTH = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ContactPayload = {
  name: string;
  email: string;
  topic: string;
  message: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * POST `/api/contact` — delivers a Help-page contact submission to the
 * support inbox via Resend. `replyTo` is set to the sender so the team can
 * reply straight from their inbox.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const topic = typeof record.topic === "string" ? record.topic.trim() : "General question";
  const message = typeof record.message === "string" ? record.message.trim() : "";

  if (!name || !email || !message) {
    return NextResponse.json(
      { error: "Name, email, and message are all required." },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message is too long." }, { status: 400 });
  }

  const payload: ContactPayload = { name, email, topic, message };

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from: CONTACT_FROM,
      to: CONTACT_INBOX,
      replyTo: payload.email,
      subject: `[Contact] ${payload.topic} — ${payload.name}`,
      text:
        `Name: ${payload.name}\n` +
        `Email: ${payload.email}\n` +
        `Topic: ${payload.topic}\n\n` +
        payload.message,
      html:
        `<p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>` +
        `<p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>` +
        `<p><strong>Topic:</strong> ${escapeHtml(payload.topic)}</p>` +
        `<hr />` +
        `<p>${escapeHtml(payload.message).replace(/\n/g, "<br />")}</p>`
    });

    if (error) {
      console.error("Resend failed to send contact email", error);
      return NextResponse.json(
        { error: "We couldn't send your message right now. Please try again." },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("Contact form submission failed", err);
    return NextResponse.json(
      { error: "We couldn't send your message right now. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
