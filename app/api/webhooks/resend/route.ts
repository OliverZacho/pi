import { NextResponse } from "next/server";
import { getResend, getResendWebhookSecret } from "@/lib/resend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { Json } from "@/types/supabase";

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

  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("webhook_events")
    .select("id, status")
    .eq("svix_id", svixId)
    .maybeSingle();

  if (existingError) {
    console.error("Failed to look up existing webhook event", existingError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (existing?.id) {
    return NextResponse.json(
      { received: true, eventId: existing.id, deduplicated: true, status: existing.status },
      { status: 202 }
    );
  }

  if (event.type !== "email.received") {
    const { data: skipped, error: skipError } = await supabaseAdmin
      .from("webhook_events")
      .insert({
        source: "resend",
        svix_id: svixId,
        event_type: event.type,
        status: "skipped",
        processed_at: new Date().toISOString(),
        payload: event as unknown as Json
      })
      .select("id")
      .single();

    if (skipError) {
      console.error("Failed to log skipped webhook event", skipError);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ ignored: event.type, eventId: skipped.id }, { status: 202 });
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      source: "resend",
      svix_id: svixId,
      event_type: event.type,
      status: "received",
      payload: event as unknown as Json
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("Failed to enqueue webhook event", insertError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ received: true, eventId: inserted.id }, { status: 202 });
}
