import type { Resend } from "resend";
import { storeProcessedEmail } from "./admin-db";
import type { EmailCategory } from "./admin-types";
import { classifyEmail } from "./classify";
import { processEmailForCompanyLogo } from "./company-logos";
import { extractImageUrlsFromHtml } from "./email-utils";
import { detectEsp } from "./esp-detect";
import { extractMetadata, type ParsedLink } from "./extract-metadata";
import { extractImagePaletteForEmail } from "./extract-image-palette";
import { classifyPaletteBuckets } from "./color-buckets";
import { buildImageStats } from "./image-stats";
import { recomputeCompanyMarket } from "./market-detect";
import { getResend } from "./resend";
import { mirrorRemoteImages, uploadEmailHtml, type MirroredImage } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  ingestSupportEmail,
  isSupportRecipient,
  recipientsFromEvent
} from "./support-inbox";
import {
  extractProductsFromHeroImage,
  persistExtractedProducts
} from "./vision-classify";
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

  // Mail to support@pirol.app rides the same inbound webhook as newsletters.
  // Route it to the support inbox before the captured_emails pipeline, which
  // would have no matching brand inbox and would otherwise fail.
  if (isSupportRecipient(recipientsFromEvent(event))) {
    try {
      const resend = getResend();
      const result = await ingestSupportEmail(resend, event);
      await markEventStatus(row.id, "processed");
      return {
        eventId: row.id,
        status: "processed",
        emailId: result.id,
        deduplicated: result.deduplicated
      };
    } catch (error) {
      const message = serializeProcessingError(error);
      console.error("Support email processing failed", {
        eventId: row.id,
        svixId: row.svix_id,
        resendEmailId: event.data.email_id,
        from: event.data.from,
        subject: event.data.subject,
        error
      });
      await markEventStatus(row.id, "failed", message);
      return { eventId: row.id, status: "failed", error: message };
    }
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
    const message = serializeProcessingError(error);
    console.error("Webhook event processing failed", {
      eventId: row.id,
      svixId: row.svix_id,
      resendEmailId: event.data.email_id,
      from: event.data.from,
      subject: event.data.subject,
      error
    });
    await markEventStatus(row.id, "failed", message);
    return { eventId: row.id, status: "failed", error: message };
  }
}

class StageError extends Error {
  readonly stage: string;
  readonly cause: unknown;

  constructor(stage: string, cause: unknown) {
    super(`${stage}: ${describeCause(cause)}`);
    this.name = "StageError";
    this.stage = stage;
    this.cause = cause;
  }
}

async function runStage<T>(stage: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StageError) {
      throw error;
    }
    throw new StageError(stage, error);
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message || cause.name || "Error with empty message";
  }
  if (cause === null || cause === undefined) {
    return String(cause);
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    const json = JSON.stringify(cause);
    if (json && json !== "{}") {
      return json;
    }
  } catch {
    /* ignore stringify failures */
  }
  return Object.prototype.toString.call(cause);
}

function serializeProcessingError(error: unknown): string {
  if (error instanceof StageError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message || `${error.name || "Error"} (no message)`;
  }
  return `non-error thrown: ${describeCause(error)}`;
}

async function ingestEmailReceivedEvent(
  resend: Resend,
  event: ResendInboundEvent
): Promise<{ id: string; deduplicated: boolean }> {
  const { data: full, error: fetchError } = await runStage(
    "fetch_resend_email",
    () => resend.emails.receiving.get(event.data.email_id)
  );

  if (fetchError || !full) {
    const reason = fetchError?.message ?? "no body returned";
    throw new StageError("fetch_resend_email", new Error(reason));
  }

  const html = full.html ?? full.text ?? "";
  const plainText = full.text ?? undefined;
  const subject = full.subject ?? "(no subject)";
  const headers = (full as { headers?: Record<string, string> | null }).headers ?? null;

  const recipientCandidates = [
    ...(full.to ?? []),
    ...(full.cc ?? []),
    ...(full.bcc ?? []),
    ...(event.data.to ?? [])
  ];

  const remoteImageUrls = extractImageUrlsFromHtml(html);

  const supabaseAdmin = getSupabaseAdmin();
  const existing = await runStage("dedup_lookup", async () => {
    const { data, error } = await supabaseAdmin
      .from("captured_emails")
      .select("id")
      .eq("resend_message_id", full.id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  });

  if (existing?.id) {
    return { id: existing.id, deduplicated: true };
  }

  const htmlStoragePath = await runStage("upload_html", () =>
    uploadEmailHtml(full.id, html)
  );
  const mirror = await runStage("mirror_images", () =>
    mirrorRemoteImages(remoteImageUrls)
  );

  const metadata = await runStage("extract_metadata", () =>
    extractMetadata({
      subject,
      html,
      plainText,
      mirroredAssets: mirror.stored,
      headers
    })
  );

  // Pixel-based brand palette from the mirrored content images, plus the
  // Explore colour buckets classified from a true area share of those pixels.
  // Never throws — returns empty results on any failure — so it can't break
  // ingestion.
  const { palette: imagePalette, buckets: imageColorBuckets } = await runStage(
    "extract_image_palette",
    () => extractImagePaletteForEmail(mirror.storedPaths)
  );

  // Colour buckets that power the Explore colour filter. The pixel path measures
  // real coverage (a colour is tagged only when it visibly fills the email), so
  // prefer it; fall back to the count-based markup tokens only when there were
  // no analysable images. Pure/local, so no separate runStage.
  const colorBuckets =
    imagePalette.length > 0
      ? imageColorBuckets
      : classifyPaletteBuckets(metadata.palette_colors);

  const espResult = await runStage("detect_esp", () =>
    detectEsp({
      headers,
      html,
      links: metadata.links,
      resourceHosts: metadata.resource_hosts
    })
  );

  const sentAt = full.created_at ?? event.data.created_at ?? event.created_at;

  const classification = await runStage("classify_email", () =>
    classifyEmail({ subject, html, plainText, senderDomain: full.from, sentAt })
  );

  const primaryCtaUrl = resolvePrimaryCtaUrl(
    classification.primaryCtaUrlHint ?? null,
    metadata.links
  );

  const imageMirrorMap = mirror.stored.reduce<Record<string, string>>((acc, asset) => {
    if (asset.remoteUrl && asset.storagePath) {
      acc[asset.remoteUrl] = asset.storagePath;
    }
    return acc;
  }, {});

  const imageStats = buildImageStats(mirror.stored);

  const enrichmentMetadata = {
    link_domains: metadata.link_domains,
    utm_index: metadata.utm_index,
    subject_metadata: metadata.subject_metadata,
    word_count: metadata.word_count,
    image_count: metadata.image_count,
    image_to_text_ratio: metadata.image_to_text_ratio,
    has_amp_html: metadata.has_amp_html,
    esp_candidates: espResult.candidates,
    image_mirror_map: imageMirrorMap,
    image_stats: imageStats,
    palette_colors: metadata.palette_colors,
    image_palette: imagePalette,
    font_families: metadata.font_families
  };

  const stored = await runStage("store_email", () =>
    storeProcessedEmail({
      resendId: full.id,
      toCandidates: recipientCandidates,
      from: full.from,
      subject,
      html,
      plainText,
      sentAt,
      rawPayload: { event, full, mirrorFailures: mirror.failedUrls },
      htmlStoragePath,
      imageStoragePaths: mirror.storedPaths,
      remoteImageUrls,
      colorBuckets,
      classification: {
        category: classification.category,
        confidence: classification.confidence,
        source: classification.source,
        model: classification.model,
        reasoning: classification.reasoning,
        discountPercent: classification.discountPercent ?? null,
        discountAmount: classification.discountAmount ?? null,
        currency: classification.currency ?? null,
        promoCode: classification.promoCode ?? null,
        offerEndsOn: classification.offerEndsOn ?? null,
        offerIsExtension: classification.offerIsExtension ?? null,
        primaryCtaText: classification.primaryCtaText ?? null,
        primaryCtaUrlHint: classification.primaryCtaUrlHint ?? null,
        detectedCountry: classification.detectedCountry ?? null,
        countryConfidence: classification.countryConfidence ?? null,
        countrySignals: classification.countrySignals ?? null
      },
      enrichment: {
        espProvider: espResult.provider === "unknown" ? null : espResult.provider,
        espConfidence: espResult.confidence,
        espSignals: espResult.signals,
        preheader: metadata.preheader,
        preheaderPadded: metadata.preheader_padded,
        hasGif: metadata.has_gif,
        hasDarkMode: metadata.has_dark_mode,
        primaryCtaUrl,
        authResults: metadata.auth_results,
        listHeaders: metadata.list_headers,
        metadata: enrichmentMetadata
      }
    })
  );

  if (!stored.deduplicated) {
    await runVisionExtractionStage({
      emailId: stored.id,
      category: classification.category,
      imageToTextRatio: metadata.image_to_text_ratio,
      mirroredAssets: mirror.stored
    });

    await runLogoExtractionStage({
      emailId: stored.id,
      html,
      mirroredAssets: mirror.stored
    });

    await runMarketRollupStage(stored.id);
  }

  return stored;
}

/**
 * Recomputes the brand's primary market from its emails' detected countries
 * after a fresh email lands. Non-blocking: a rollup failure must never fail the
 * ingest, since the per-email country has already been persisted and the brand
 * will be corrected on the next email regardless.
 */
async function runMarketRollupStage(emailId: string): Promise<void> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: emailRow, error } = await supabaseAdmin
      .from("captured_emails")
      .select("company_id")
      .eq("id", emailId)
      .maybeSingle();

    if (error || !emailRow?.company_id) {
      return;
    }

    await recomputeCompanyMarket(emailRow.company_id);
  } catch (error) {
    console.warn("Market rollup stage threw (non-blocking)", {
      emailId,
      error: error instanceof Error ? error.message : "unknown market rollup error"
    });
  }
}

async function runLogoExtractionStage(args: {
  emailId: string;
  html: string;
  mirroredAssets: MirroredImage[];
}): Promise<void> {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: emailRow, error: emailError } = await supabaseAdmin
      .from("captured_emails")
      .select("company_id, companies(domain)")
      .eq("id", args.emailId)
      .maybeSingle();

    if (emailError || !emailRow?.company_id) {
      return;
    }

    const company = Array.isArray(emailRow.companies)
      ? emailRow.companies[0]
      : emailRow.companies;
    const companyDomain = company?.domain ?? null;
    if (!companyDomain) {
      return;
    }

    const { count } = await supabaseAdmin
      .from("captured_emails")
      .select("id", { count: "exact", head: true })
      .eq("company_id", emailRow.company_id);

    const result = await processEmailForCompanyLogo({
      companyId: emailRow.company_id,
      companyDomain,
      html: args.html,
      mirroredAssets: args.mirroredAssets,
      emailCountForCompany: count ?? 1
    });

    if (result.applied) {
      console.info("Company logo updated", {
        emailId: args.emailId,
        companyId: emailRow.company_id,
        source: result.applied.source,
        confidence: result.applied.confidence
      });
    }
  } catch (error) {
    console.warn("Logo extraction stage threw (non-blocking)", {
      emailId: args.emailId,
      error: error instanceof Error ? error.message : "unknown logo extraction error"
    });
  }
}

async function runVisionExtractionStage(args: {
  emailId: string;
  category: EmailCategory;
  imageToTextRatio: number;
  mirroredAssets: Awaited<ReturnType<typeof mirrorRemoteImages>>["stored"];
}): Promise<void> {
  try {
    const result = await extractProductsFromHeroImage({
      category: args.category,
      imageToTextRatio: args.imageToTextRatio,
      mirroredAssets: args.mirroredAssets
    });

    if (result.error) {
      console.warn("Vision extraction failed (non-blocking)", {
        emailId: args.emailId,
        error: result.error
      });
      return;
    }

    if (!result.attempted || result.products.length === 0) {
      return;
    }

    await persistExtractedProducts(args.emailId, result);
  } catch (error) {
    console.warn("Vision extraction threw (non-blocking)", {
      emailId: args.emailId,
      error: error instanceof Error ? error.message : "unknown vision error"
    });
  }
}

/**
 * Resolves the LLM-extracted CTA URL hint to a stored URL.
 *
 * Resolution order:
 *  1. Exact match against an `<a href>` we extracted from the HTML.
 *  2. Same-host match against an `<a href>` we extracted from the HTML.
 *  3. The hint URL itself, when it parses as a valid http(s) URL but does
 *     not match any HTML link. This is the common case for senders that
 *     wrap every `<a href>` in a click-tracker (Klaviyo `ctrk.klclick.com`,
 *     Mailchimp `list-manage.com`, HubSpot, Marketo, …): the destination
 *     URL only appears in the `text/plain` MIME part, which is exactly
 *     what the LLM sees, so the hint is the only place we'll find a
 *     human-meaningful destination. We'd rather record it than `null`.
 *
 * Bare hosts (`norr11.com`) and hosts without a scheme are normalised by
 * trying an `https://` prefix; relative paths and non-URL strings are
 * rejected.
 */
export function resolvePrimaryCtaUrl(
  hint: string | null,
  links: ParsedLink[]
): string | null {
  if (!hint) {
    return null;
  }

  const trimmed = hint.trim();
  if (!trimmed) {
    return null;
  }

  const exact = links.find((link) => link.url === trimmed);
  if (exact) {
    return exact.url;
  }

  const parsed = parseHintUrl(trimmed);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return null;
  }

  const byHost = links.find((link) => link.host && link.host === host);
  if (byHost) {
    return byHost.url;
  }

  return parsed.toString();
}

function parseHintUrl(value: string): URL | null {
  const tryParse = (input: string): URL | null => {
    try {
      const u = new URL(input);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return null;
      }
      return u;
    } catch {
      return null;
    }
  };

  const direct = tryParse(value);
  if (direct) {
    return direct;
  }

  // Bare hosts ("norr11.com") and host+path strings ("norr11.com/foo") don't
  // parse on their own. Re-try with an https:// prefix, but only if the value
  // looks like a host — i.e. starts with a TLD-ish token rather than a "/".
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(value)) {
    return tryParse(`https://${value}`);
  }

  return null;
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
