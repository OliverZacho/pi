import { NextResponse } from "next/server";
import { storeWebhookEmailInDb } from "@/lib/admin-db";
import type { CapturedEmail } from "@/lib/admin-types";

type ResendInboundPayload = {
  to?: string;
  from?: string;
  subject?: string;
  html?: string;
  sentAt?: string;
  llm?: {
    category?: CapturedEmail["category"];
    confidence?: number;
  };
};

export async function POST(request: Request) {
  try {
    // TODO: verify webhook signature once Resend signing secret is configured.
    const payload = (await request.json()) as ResendInboundPayload;

    if (!payload.to || !payload.from || !payload.subject || !payload.html) {
      return NextResponse.json(
        { error: "Missing required fields: to, from, subject, html" },
        { status: 400 }
      );
    }

    const email = await storeWebhookEmailInDb({
      to: payload.to,
      from: payload.from,
      subject: payload.subject,
      html: payload.html,
      sentAt: payload.sentAt,
      llmCategory: payload.llm?.category,
      llmConfidence: payload.llm?.confidence
    });

    return NextResponse.json({ received: true, emailId: email.id }, { status: 202 });
  } catch (error) {
    console.error("Failed to ingest resend webhook", error);
    return NextResponse.json({ error: "Failed to ingest webhook payload" }, { status: 500 });
  }
}
