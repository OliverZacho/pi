import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminOverview, CapturedEmail, CompanySubscription } from "./admin-types";
import { buildUniqueSubscriptionEmail, classifyFromRules, extractImageUrlsFromHtml } from "./email-utils";
import { getSupabaseAdmin } from "./supabase-admin";

const categories: AdminOverview["categories"] = [
  "new_launch",
  "sale",
  "newsletter",
  "product_update",
  "event",
  "other"
];

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function getOverviewFromDb(supabase: SupabaseClient): Promise<AdminOverview> {
  const [{ data: companiesRaw, error: companiesError }, { data: emailsRaw, error: emailsError }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id, name, domain, subscribed_since, company_inboxes(email_address, is_primary)")
        .order("subscribed_since", { ascending: false }),
      supabase
        .from("captured_emails")
        .select(
          "id, sender_email, subject, sent_at, received_at, image_urls, category, classification_source, classification_confidence, companies(name)"
        )
        .order("received_at", { ascending: false })
        .limit(50)
    ]);

  if (companiesError) {
    throw companiesError;
  }
  if (emailsError) {
    throw emailsError;
  }

  const companies: CompanySubscription[] = (companiesRaw ?? []).map((row) => {
    const inboxes = row.company_inboxes ?? [];
    const primaryInbox =
      inboxes.find((inbox) => inbox.is_primary)?.email_address ?? "unassigned@pirol.app";
    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      subscriptionEmail: primaryInbox,
      subscribedAt: row.subscribed_since
    };
  });

  const emails: CapturedEmail[] = (emailsRaw ?? []).map((row) => {
    const company = relationFirst(row.companies);
    return {
    id: row.id,
    companyId: "",
    companyName: company?.name ?? "unknown-company",
    sender: row.sender_email,
    subject: row.subject,
    sentAt: row.sent_at ?? row.received_at,
    receivedAt: row.received_at,
    html: "",
    imageUrls: row.image_urls ?? [],
    category: row.category as CapturedEmail["category"],
    classificationSource: row.classification_source as CapturedEmail["classificationSource"],
    classificationConfidence: Number(row.classification_confidence ?? 0)
    };
  });

  return {
    companies,
    emails,
    categories,
    storageNotes:
      "Supabase configured: metadata in Postgres. Next step is moving image binaries and full raw mime to Storage."
  };
}

export async function createCompanySubscriptionInDb(
  supabase: SupabaseClient,
  input: {
  name: string;
  domain: string;
}): Promise<CompanySubscription> {
  const normalizedName = input.name.trim();
  const normalizedDomain = input.domain.trim().toLowerCase();

  const { data: existingInboxes, error: inboxesError } = await supabase
    .from("company_inboxes")
    .select("email_address");

  if (inboxesError) {
    throw inboxesError;
  }

  const subscriptionEmail = buildUniqueSubscriptionEmail(
    normalizedName,
    (existingInboxes ?? []).map((item) => item.email_address)
  );

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({ name: normalizedName, domain: normalizedDomain })
    .select("id, name, domain, subscribed_since")
    .single();

  if (companyError) {
    throw companyError;
  }

  const { error: inboxError } = await supabase.from("company_inboxes").insert({
    company_id: company.id,
    email_address: subscriptionEmail,
    is_primary: true
  });

  if (inboxError) {
    throw inboxError;
  }

  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    subscriptionEmail,
    subscribedAt: company.subscribed_since
  };
}

export async function storeWebhookEmailInDb(input: {
  resendId: string;
  toCandidates: string[];
  from: string;
  subject: string;
  html: string;
  sentAt?: string;
  rawPayload: unknown;
  llmCategory?: CapturedEmail["category"];
  llmConfidence?: number;
}): Promise<{ id: string; deduplicated: boolean }> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing } = await supabaseAdmin
    .from("captured_emails")
    .select("id")
    .eq("resend_message_id", input.resendId)
    .maybeSingle();

  if (existing?.id) {
    return { id: existing.id, deduplicated: true };
  }

  const lowercaseRecipients = input.toCandidates
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  let matchedInbox: { id: string; company_id: string; recipient: string } | null = null;

  if (lowercaseRecipients.length > 0) {
    const { data: inboxRows, error: inboxError } = await supabaseAdmin
      .from("company_inboxes")
      .select("id, company_id, email_address")
      .in("email_address", lowercaseRecipients);

    if (inboxError) {
      throw inboxError;
    }

    if (inboxRows && inboxRows.length > 0) {
      const recipientLookup = new Set(lowercaseRecipients);
      const firstMatch =
        inboxRows.find((row) => recipientLookup.has(row.email_address)) ?? inboxRows[0];
      matchedInbox = {
        id: firstMatch.id,
        company_id: firstMatch.company_id,
        recipient: firstMatch.email_address
      };
    }
  }

  const recipient = matchedInbox?.recipient ?? lowercaseRecipients[0] ?? "unknown@pirol.app";

  const rules = classifyFromRules(input.subject, input.html);
  const category = input.llmCategory ?? rules.category;
  const confidence = input.llmConfidence ?? rules.confidence;
  const source = input.llmCategory ? "llm" : "rules";
  const imageUrls = extractImageUrlsFromHtml(input.html);

  const { data: email, error: emailError } = await supabaseAdmin
    .from("captured_emails")
    .insert({
      company_id: matchedInbox?.company_id ?? null,
      inbox_id: matchedInbox?.id ?? null,
      resend_message_id: input.resendId,
      sender_email: input.from,
      recipient_email: recipient,
      subject: input.subject,
      sent_at: input.sentAt ?? new Date().toISOString(),
      html_content: input.html,
      image_urls: imageUrls,
      category,
      classification_source: source,
      classification_confidence: confidence,
      llm_model: input.llmCategory ? "external-llm" : null,
      raw_payload: input.rawPayload as never
    })
    .select("id")
    .single();

  if (emailError) {
    throw emailError;
  }

  return { id: email.id, deduplicated: false };
}
