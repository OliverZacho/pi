import type { Resend } from "resend";
import { storeProcessedEmail } from "./admin-db";
import { classifyEmail } from "./classify";
import { extractImageUrlsFromHtml } from "./email-utils";
import { getResend } from "./resend";
import { mirrorRemoteImages, uploadEmailHtml } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";
import type { TablesUpdate } from "@/types/supabase";

type WebhookEventUpdate = TablesUpdate<"webhook_events">;

type ResendInboundEvent = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    created_at?: string;
    from: string;
    to?: string[];
    bcc?: string[];
    cc?: string[];
    subject: string;
    message_id?: string;
  };
};

type WebhookEventRow = {
  id: string;
  source: string;
  svix_id: string | null;
  event_type: string;
  status: string;
  attempt_count: number;
  payload: ResendInboundEvent | null;
};

const PROCESSOR_BATCH_SIZE = 5;

export type ProcessEventOutcome = {
  eventId: string;
  status: "processed" | "failed" | "skipped";
  emailId?: string;
  deduplicated?: boolean;
  error?: string;
};

export type ProcessBatchResult = {
  claimed: number;
  processed: number;
  failed: number;
  skipped: number;
  outcomes: ProcessEventOutcome[];
};

export async function processNextBatch(
  limit: number = PROCESSOR_BATCH_SIZE
): Promise<ProcessBatchResult> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin.rpc("claim_webhook_events", {
    batch_limit: limit
  });

  if (error) {
    throw new Error(`Failed to claim webhook_events: ${error.message}`);
  }

  const rows = (data ?? []) as WebhookEventRow[];
  const outcomes: ProcessEventOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await runClaimedEvent(row));
  }

  return {
    claimed: rows.length,
    processed: outcomes.filter((o) => o.status === "processed").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    outcomes
  };
}

export async function processEvent(eventId: string): Promise<ProcessEventOutcome> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: row, error } = await supabaseAdmin
    .from("webhook_events")
    .update({ status: "processing" })
    .eq("id", eventId)
    .in("status", ["received", "failed"])
    .select("id, source, svix_id, event_type, status, attempt_count, payload")
    .maybeSingle();

  if (error) {
    return { eventId, status: "failed", error: error.message };
  }

  if (!row) {
    return { eventId, status: "skipped", error: "event not in claimable state" };
  }

  const claimed = row as WebhookEventRow;

  await supabaseAdmin
    .from("webhook_events")
    .update({ attempt_count: (claimed.attempt_count ?? 0) + 1 })
    .eq("id", eventId);

  return runClaimedEvent({ ...claimed, attempt_count: (claimed.attempt_count ?? 0) + 1 });
}

async function runClaimedEvent(row: WebhookEventRow): Promise<ProcessEventOutcome> {
  const event = row.payload;

  if (!event || event.type !== "email.received") {
    await markEventStatus(row.id, "skipped", `event_type=${event?.type ?? "unknown"}`);
    return {
      eventId: row.id,
      status: "skipped",
      error: `unsupported event type: ${event?.type ?? "unknown"}`
    };
  }

  try {
    const resend = getResend();
    const result = await ingestEmailReceivedEvent(resend, event);
    await markEventStatus(row.id, "processed");
    return {
      eventId: row.id,
      status: "processed",
      emailId: result.id,
      deduplicated: result.deduplicated
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown processing error";
    await markEventStatus(row.id, "failed", message);
    return { eventId: row.id, status: "failed", error: message };
  }
}

async function ingestEmailReceivedEvent(
  resend: Resend,
  event: ResendInboundEvent
): Promise<{ id: string; deduplicated: boolean }> {
  const { data: full, error: fetchError } = await resend.emails.receiving.get(
    event.data.email_id
  );

  if (fetchError || !full) {
    const reason = fetchError?.message ?? "no body returned";
    throw new Error(`Failed to fetch received email from Resend: ${reason}`);
  }

  const html = full.html ?? full.text ?? "";
  const plainText = full.text ?? undefined;
  const subject = full.subject ?? "(no subject)";

  const recipientCandidates = [
    ...(full.to ?? []),
    ...(full.cc ?? []),
    ...(full.bcc ?? []),
    ...(event.data.to ?? [])
  ];

  const remoteImageUrls = extractImageUrlsFromHtml(html);

  const supabaseAdmin = getSupabaseAdmin();
  const { data: existing } = await supabaseAdmin
    .from("captured_emails")
    .select("id")
    .eq("resend_message_id", full.id)
    .maybeSingle();

  if (existing?.id) {
    return { id: existing.id, deduplicated: true };
  }

  const htmlStoragePath = await uploadEmailHtml(full.id, html);
  const mirror = await mirrorRemoteImages(full.id, remoteImageUrls);
  const classification = await classifyEmail({ subject, html, plainText });

  return storeProcessedEmail({
    resendId: full.id,
    toCandidates: recipientCandidates,
    from: full.from,
    subject,
    html,
    plainText,
    sentAt: full.created_at ?? event.data.created_at ?? event.created_at,
    rawPayload: { event, full, mirrorFailures: mirror.failedUrls },
    htmlStoragePath,
    imageStoragePaths: mirror.storedPaths,
    remoteImageUrls,
    classification: {
      category: classification.category,
      confidence: classification.confidence,
      source: classification.source,
      model: classification.model,
      reasoning: classification.reasoning
    }
  });
}

async function markEventStatus(
  eventId: string,
  status: "processed" | "failed" | "skipped",
  errorMessage?: string
): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const update: WebhookEventUpdate = {
    status,
    processed_at: new Date().toISOString(),
    last_error:
      status === "failed"
        ? errorMessage ?? "unknown error"
        : status === "skipped"
          ? errorMessage ?? null
          : null
  };

  const { error } = await supabaseAdmin
    .from("webhook_events")
    .update(update)
    .eq("id", eventId);

  if (error) {
    console.error("Failed to mark webhook_event status", { eventId, status, error });
  }
}
