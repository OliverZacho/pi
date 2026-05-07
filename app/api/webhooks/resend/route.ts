import { NextResponse } from "next/server";
import { getResend, getResendWebhookSecret } from "@/lib/resend";
import { storeWebhookEmailInDb } from "@/lib/admin-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResendInboundEvent = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    created_at?: string;
    from: string;
    to: string[];
    bcc?: string[];
    cc?: string[];
    subject: string;
    message_id?: string;
  };
};

export async function POST(request: Request) {
  const rawBody = await request.text();

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 });
  }

  const resend = getResend();
  const webhookSecret = getResendWebhookSecret();

  let event: ResendInboundEvent;
  try {
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret
    }) as unknown as ResendInboundEvent;
  } catch (error) {
    console.error("Resend webhook signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ ignored: event.type }, { status: 202 });
  }

  try {
    const { data: full, error: fetchError } = await resend.emails.receiving.get(event.data.email_id);
    if (fetchError || !full) {
      console.error("Failed to fetch received email from Resend", fetchError);
      return NextResponse.json({ error: "Failed to fetch email content" }, { status: 502 });
    }

    const recipientCandidates = [
      ...(full.to ?? []),
      ...(full.cc ?? []),
      ...(full.bcc ?? []),
      ...(event.data.to ?? [])
    ];

    const result = await storeWebhookEmailInDb({
      resendId: full.id,
      toCandidates: recipientCandidates,
      from: full.from,
      subject: full.subject ?? "(no subject)",
      html: full.html ?? full.text ?? "",
      sentAt: full.created_at ?? event.data.created_at ?? event.created_at,
      rawPayload: { event, full }
    });

    return NextResponse.json(
      { received: true, emailId: result.id, deduplicated: result.deduplicated },
      { status: 202 }
    );
  } catch (error) {
    console.error("Failed to ingest resend webhook", error);
    return NextResponse.json({ error: "Failed to ingest webhook payload" }, { status: 500 });
  }
}
