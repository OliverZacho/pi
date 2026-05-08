import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminOverview,
  CapturedEmail,
  CapturedEmailDetail,
  CompanyDetail,
  CompanySubscription,
  EmailCategory
} from "./admin-types";
import { buildUniqueSubscriptionEmail } from "./email-utils";
import { getSignedAssets, getSignedHtml } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";
import type { Database, Json } from "@/types/supabase";

type PirolDb = SupabaseClient<Database>;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const COMPANY_RECENT_EMAIL_LIMIT = 25;

const VALID_CATEGORIES: EmailCategory[] = [
  "sale",
  "product_launch",
  "event",
  "content",
  "loyalty",
  "transactional",
  "seasonal",
  "partnership",
  "company_news",
  "other"
];

const categories: AdminOverview["categories"] = [...VALID_CATEGORIES];

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type GetOverviewOptions = {
  cursor?: string | null;
  category?: EmailCategory | null;
  pageSize?: number;
};

export async function getOverviewFromDb(
  supabase: PirolDb,
  options: GetOverviewOptions = {}
): Promise<AdminOverview> {
  const requestedSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(requestedSize, MAX_PAGE_SIZE));

  let emailsQuery = supabase
    .from("captured_emails")
    .select(
      "id, company_id, sender_email, subject, sent_at, received_at, image_urls, category, subcategory, classification_source, classification_confidence, companies(id, name)"
    )
    .order("received_at", { ascending: false })
    .limit(pageSize + 1);

  if (options.category) {
    if (!VALID_CATEGORIES.includes(options.category)) {
      throw new Error(`Invalid category filter: ${options.category}`);
    }
    emailsQuery = emailsQuery.eq("category", options.category);
  }

  if (options.cursor) {
    emailsQuery = emailsQuery.lt("received_at", options.cursor);
  }

  const [{ data: companiesRaw, error: companiesError }, { data: emailsRaw, error: emailsError }] =
    await Promise.all([
      supabase
        .from("companies")
        .select(
          "id, name, domain, market, subscribed_since, company_inboxes(email_address, is_primary), company_email_stats(email_count, last_received_at)"
        )
        .is("deleted_at", null)
        .order("subscribed_since", { ascending: false }),
      emailsQuery
    ]);

  if (companiesError) {
    throw companiesError;
  }
  if (emailsError) {
    throw emailsError;
  }

  const companies = (companiesRaw ?? []).map(rowToCompany);

  const emailRows = emailsRaw ?? [];
  const hasMore = emailRows.length > pageSize;
  const trimmed = hasMore ? emailRows.slice(0, pageSize) : emailRows;
  const emails: CapturedEmail[] = trimmed.map(rowToCapturedEmail);

  const nextCursor = hasMore ? trimmed[trimmed.length - 1].received_at : null;

  return {
    companies,
    emails,
    categories,
    storageNotes:
      "Raw HTML and rehosted email assets live in private Supabase Storage buckets (email-html, email-assets); APIs serve them via short-lived signed URLs.",
    pagination: {
      nextCursor,
      pageSize
    }
  };
}

export async function getEmailDetailFromDb(
  supabase: PirolDb,
  emailId: string
): Promise<CapturedEmailDetail | null> {
  const { data, error } = await supabase
    .from("captured_emails")
    .select(
      "id, company_id, sender_email, recipient_email, subject, sent_at, received_at, html_content, html_storage_path, image_urls, remote_image_urls, category, subcategory, classification_source, classification_confidence, llm_model, llm_reasoning, processed_at, companies(id, name)"
    )
    .eq("id", emailId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  const company = relationFirst(data.companies);
  const imagePaths: string[] = data.image_urls ?? [];

  const [htmlSignedUrl, signedAssets] = await Promise.all([
    data.html_storage_path ? getSignedHtml(data.html_storage_path) : Promise.resolve(null),
    getSignedAssets(imagePaths)
  ]);

  return {
    id: data.id,
    companyId: data.company_id ?? null,
    companyName: company?.name ?? "unknown-company",
    sender: data.sender_email,
    subject: data.subject,
    sentAt: data.sent_at ?? data.received_at,
    receivedAt: data.received_at,
    html: data.html_content ?? "",
    imageUrls: imagePaths,
    category: data.category as CapturedEmail["category"],
    subcategory: data.subcategory ?? null,
    classificationSource: data.classification_source as CapturedEmail["classificationSource"],
    classificationConfidence: Number(data.classification_confidence ?? 0),
    recipient: data.recipient_email,
    htmlSignedUrl,
    imageSignedUrls: imagePaths
      .map((path) => ({ storagePath: path, signedUrl: signedAssets[path] ?? null }))
      .filter((item): item is { storagePath: string; signedUrl: string } => item.signedUrl !== null),
    remoteImageUrls: data.remote_image_urls ?? [],
    llmModel: data.llm_model ?? null,
    llmReasoning: data.llm_reasoning ?? null,
    processedAt: data.processed_at ?? null
  };
}

export async function getCompanyDetailFromDb(
  supabase: PirolDb,
  companyId: string
): Promise<CompanyDetail | null> {
  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select(
      "id, name, domain, market, subscribed_since, deleted_at, company_inboxes(email_address, is_primary), company_email_stats(email_count, last_received_at)"
    )
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) {
    throw companyError;
  }
  if (!companyRow || companyRow.deleted_at) {
    return null;
  }

  const [{ data: emailRows, error: emailError }, { count, error: countError }] = await Promise.all([
    supabase
      .from("captured_emails")
      .select(
        "id, company_id, sender_email, subject, sent_at, received_at, image_urls, category, subcategory, classification_source, classification_confidence, companies(id, name)"
      )
      .eq("company_id", companyId)
      .order("received_at", { ascending: false })
      .limit(COMPANY_RECENT_EMAIL_LIMIT),
    supabase
      .from("captured_emails")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
  ]);

  if (emailError) {
    throw emailError;
  }
  if (countError) {
    throw countError;
  }

  return {
    ...rowToCompany(companyRow),
    recentEmails: (emailRows ?? []).map(rowToCapturedEmail),
    emailCount: count ?? 0
  };
}

export async function softDeleteCompanyInDb(
  supabase: PirolDb,
  companyId: string
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("companies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", companyId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? { id: data.id } : null;
}

type CompanyStatsRow = {
  email_count: number | null;
  last_received_at: string | null;
};

type CompanyRow = {
  id: string;
  name: string;
  domain: string;
  market: string | null;
  subscribed_since: string;
  company_inboxes?: { email_address: string; is_primary: boolean }[] | null;
  company_email_stats?: CompanyStatsRow | CompanyStatsRow[] | null;
};

type EmailListRow = {
  id: string;
  company_id: string | null;
  sender_email: string;
  subject: string;
  sent_at: string | null;
  received_at: string;
  image_urls: string[] | null;
  category: string;
  subcategory: string | null;
  classification_source: string;
  classification_confidence: number | string | null;
  companies: { id: string; name: string } | { id: string; name: string }[] | null;
};

function rowToCompany(row: CompanyRow): CompanySubscription {
  const inboxes = row.company_inboxes ?? [];
  const primaryInbox =
    inboxes.find((inbox) => inbox.is_primary)?.email_address ?? "unassigned@pirol.app";
  const stats = relationFirst(row.company_email_stats);
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    market: row.market ?? null,
    subscriptionEmail: primaryInbox,
    subscribedAt: row.subscribed_since,
    emailCount: stats?.email_count ?? 0,
    lastEmailAt: stats?.last_received_at ?? null
  };
}

function rowToCapturedEmail(row: EmailListRow): CapturedEmail {
  const company = relationFirst(row.companies);
  return {
    id: row.id,
    companyId: row.company_id ?? null,
    companyName: company?.name ?? "unknown-company",
    sender: row.sender_email,
    subject: row.subject,
    sentAt: row.sent_at ?? row.received_at,
    receivedAt: row.received_at,
    html: "",
    imageUrls: row.image_urls ?? [],
    category: row.category as CapturedEmail["category"],
    subcategory: row.subcategory ?? null,
    classificationSource: row.classification_source as CapturedEmail["classificationSource"],
    classificationConfidence: Number(row.classification_confidence ?? 0)
  };
}

export async function createCompanySubscriptionInDb(
  supabase: PirolDb,
  input: {
    name: string;
    domain: string;
    market?: string | null;
  }
): Promise<CompanySubscription> {
  const normalizedName = input.name.trim();
  const normalizedDomain = input.domain.trim().toLowerCase();
  const normalizedMarket = input.market?.trim().toLowerCase();
  const marketValue = normalizedMarket && normalizedMarket.length > 0 ? normalizedMarket : null;

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
    .insert({ name: normalizedName, domain: normalizedDomain, market: marketValue })
    .select("id, name, domain, market, subscribed_since")
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
    market: company.market ?? null,
    subscriptionEmail,
    subscribedAt: company.subscribed_since,
    emailCount: 0,
    lastEmailAt: null
  };
}

export type StoreProcessedEmailInput = {
  resendId: string;
  toCandidates: string[];
  from: string;
  subject: string;
  html: string;
  plainText?: string;
  sentAt?: string;
  rawPayload: unknown;
  htmlStoragePath: string;
  imageStoragePaths: string[];
  remoteImageUrls: string[];
  classification: {
    category: EmailCategory;
    confidence: number;
    source: "rules" | "llm" | "manual";
    model?: string;
    reasoning?: string;
  };
};

export async function storeProcessedEmail(
  input: StoreProcessedEmailInput
): Promise<{ id: string; deduplicated: boolean }> {
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
      html_storage_path: input.htmlStoragePath,
      plain_text: input.plainText ?? null,
      image_urls: input.imageStoragePaths,
      remote_image_urls: input.remoteImageUrls,
      category: input.classification.category,
      classification_source: input.classification.source,
      classification_confidence: input.classification.confidence,
      llm_model: input.classification.model ?? null,
      llm_reasoning: input.classification.reasoning ?? null,
      raw_payload: input.rawPayload as Json,
      processed_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (emailError) {
    throw emailError;
  }

  return { id: email.id, deduplicated: false };
}
