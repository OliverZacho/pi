import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_CATEGORIES,
  type AdminOverview,
  type CapturedEmail,
  type CapturedEmailDetail,
  type CompanyDetail,
  type CompanyInbox,
  type CompanySubscription,
  type EmailCategory,
  type EspProvider,
  type FontFamily,
  type FontFamilySource,
  type PaletteColor,
  type PaletteColorSource
} from "./admin-types";
import { buildUniqueSubscriptionEmail } from "./email-utils";
import { LOGO_REVIEW_MAX_CONFIDENCE } from "./extract-logo";
import {
  BRAND_LOGO_TRANSFORM,
  getSignedAssets,
  getSignedHtml,
  type ImageTransform
} from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";
import type { Database, Json } from "@/types/supabase";

type PirolDb = SupabaseClient<Database>;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const COMPANY_RECENT_EMAIL_LIMIT = 25;

const VALID_CATEGORIES: readonly EmailCategory[] = EMAIL_CATEGORIES;

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
  espProvider?: EspProvider | null;
  hasGif?: boolean | null;
  hasDarkMode?: boolean | null;
  hasPromoCode?: boolean | null;
  minDiscountPercent?: number | null;
  receivedAfter?: string | null;
  receivedBefore?: string | null;
  search?: string | null;
};

const EMAIL_LIST_COLUMNS =
  "id, company_id, sender_email, subject, sent_at, received_at, image_urls, category, subcategory, classification_source, classification_confidence, esp_provider, esp_confidence, preheader, has_gif, has_dark_mode, discount_percent, discount_amount, currency, promo_code, primary_cta_text, primary_cta_url, companies(id, name)";

export async function getOverviewFromDb(
  supabase: PirolDb,
  options: GetOverviewOptions = {}
): Promise<AdminOverview> {
  const requestedSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(requestedSize, MAX_PAGE_SIZE));

  let emailsQuery = supabase
    .from("captured_emails")
    .select(EMAIL_LIST_COLUMNS)
    .order("received_at", { ascending: false })
    .limit(pageSize + 1);

  if (options.category) {
    if (!VALID_CATEGORIES.includes(options.category)) {
      throw new Error(`Invalid category filter: ${options.category}`);
    }
    emailsQuery = emailsQuery.eq("category", options.category);
  }

  if (options.espProvider) {
    emailsQuery = emailsQuery.eq("esp_provider", options.espProvider);
  }

  if (options.hasGif === true) {
    emailsQuery = emailsQuery.eq("has_gif", true);
  }

  if (options.hasDarkMode === true) {
    emailsQuery = emailsQuery.eq("has_dark_mode", true);
  }

  if (options.hasPromoCode === true) {
    emailsQuery = emailsQuery.not("promo_code", "is", null);
  }

  if (typeof options.minDiscountPercent === "number" && Number.isFinite(options.minDiscountPercent)) {
    emailsQuery = emailsQuery.gte("discount_percent", options.minDiscountPercent);
  }

  if (options.receivedAfter) {
    emailsQuery = emailsQuery.gte("received_at", options.receivedAfter);
  }

  if (options.receivedBefore) {
    emailsQuery = emailsQuery.lte("received_at", options.receivedBefore);
  }

  if (options.search) {
    const trimmed = options.search.trim();
    if (trimmed.length > 0) {
      const sanitized = trimmed.replace(/[%,]/g, " ");
      const term = `%${sanitized}%`;
      emailsQuery = emailsQuery.or(
        `subject.ilike.${term},sender_email.ilike.${term}`
      );
    }
  }

  if (options.cursor) {
    emailsQuery = emailsQuery.lt("received_at", options.cursor);
  }

  const [{ data: companiesRaw, error: companiesError }, { data: emailsRaw, error: emailsError }] =
    await Promise.all([
      supabase
        .from("companies")
        .select(
          "id, name, domain, markets, subscribed_since, logo_storage_path, logo_source, logo_confidence, logo_stale, company_inboxes(id, email_address, is_primary, created_at), company_email_stats(email_count, last_received_at)"
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

  const companies = await resolveCompanyLogos((companiesRaw ?? []).map(rowToCompany));

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

export type GetEmailDetailOptions = {
  /**
   * Optional Supabase Storage image transform applied to every mirrored
   * image URL in the returned detail. The card-grid render endpoint
   * passes `{ width: 600, quality: 70 }` so iframes ship downscaled,
   * re-encoded variants; the modal omits this and gets the full-fidelity
   * originals.
   */
  imageTransform?: ImageTransform;
};

export async function getEmailDetailFromDb(
  supabase: PirolDb,
  emailId: string,
  options: GetEmailDetailOptions = {}
): Promise<CapturedEmailDetail | null> {
  const { data, error } = await supabase
    .from("captured_emails")
    .select(
      "id, company_id, sender_email, recipient_email, subject, sent_at, received_at, html_content, html_storage_path, image_urls, remote_image_urls, category, subcategory, classification_source, classification_confidence, llm_model, llm_reasoning, processed_at, esp_provider, esp_confidence, preheader, has_gif, has_dark_mode, discount_percent, discount_amount, currency, promo_code, primary_cta_text, primary_cta_url, detected_country, country_confidence, auth_results, list_headers, metadata, companies(id, name, primary_market_country)"
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
    getSignedAssets(imagePaths, { transform: options.imageTransform })
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
    espProvider: (data.esp_provider as EspProvider | null) ?? null,
    espConfidence: data.esp_confidence === null ? null : Number(data.esp_confidence),
    preheader: data.preheader ?? null,
    hasGif: data.has_gif ?? false,
    hasDarkMode: data.has_dark_mode ?? false,
    discountPercent: data.discount_percent === null ? null : Number(data.discount_percent),
    discountAmount: data.discount_amount === null ? null : Number(data.discount_amount),
    currency: data.currency ?? null,
    promoCode: data.promo_code ?? null,
    primaryCtaText: data.primary_cta_text ?? null,
    primaryCtaUrl: data.primary_cta_url ?? null,
    recipient: data.recipient_email,
    htmlContent: data.html_content ?? "",
    htmlSignedUrl,
    imageSignedUrls: imagePaths
      .map((path) => ({ storagePath: path, signedUrl: signedAssets[path] ?? null }))
      .filter((item): item is { storagePath: string; signedUrl: string } => item.signedUrl !== null),
    imageMirrorMap: parseImageMirrorMap(data.metadata),
    remoteImageUrls: data.remote_image_urls ?? [],
    llmModel: data.llm_model ?? null,
    llmReasoning: data.llm_reasoning ?? null,
    processedAt: data.processed_at ?? null,
    authResults: parseAuthResults(data.auth_results),
    listHeaders: parseListHeaders(data.list_headers),
    paletteColors: parsePaletteColors(data.metadata),
    fontFamilies: parseFontFamilies(data.metadata),
    metadata: parseMetadata(data.metadata),
    detectedCountry: data.detected_country ?? null,
    countryConfidence:
      data.country_confidence === null || data.country_confidence === undefined
        ? null
        : Number(data.country_confidence),
    companyPrimaryMarketCountry: company?.primary_market_country ?? null
  };
}

const PALETTE_SOURCE_VALUES: PaletteColorSource[] = ["inline", "style_block", "attribute"];

function parsePaletteColors(value: unknown): PaletteColor[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const candidate = (value as Record<string, unknown>).palette_colors;
  if (!Array.isArray(candidate)) {
    return [];
  }
  const result: PaletteColor[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const hex = typeof entry.hex === "string" ? entry.hex.toLowerCase() : null;
    if (!hex || !/^#[0-9a-f]{6}$/.test(hex)) {
      continue;
    }
    const count = typeof entry.count === "number" && Number.isFinite(entry.count)
      ? Math.max(0, Math.floor(entry.count))
      : 0;
    const rawSources = Array.isArray(entry.sources) ? entry.sources : [];
    const sources = rawSources.filter(
      (s): s is PaletteColorSource =>
        typeof s === "string" && (PALETTE_SOURCE_VALUES as string[]).includes(s)
    );
    result.push({ hex, count, sources });
  }
  return result;
}

const FONT_SOURCE_VALUES: FontFamilySource[] = ["inline", "style_block", "attribute"];

function parseFontFamilies(value: unknown): FontFamily[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const candidate = (value as Record<string, unknown>).font_families;
  if (!Array.isArray(candidate)) {
    return [];
  }
  const result: FontFamily[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const family = typeof entry.family === "string" ? entry.family.trim() : "";
    if (!family) {
      continue;
    }
    const count =
      typeof entry.count === "number" && Number.isFinite(entry.count)
        ? Math.max(0, Math.floor(entry.count))
        : 0;
    const primaryCount =
      typeof entry.primary_count === "number" && Number.isFinite(entry.primary_count)
        ? Math.max(0, Math.floor(entry.primary_count))
        : 0;
    const rawSources = Array.isArray(entry.sources) ? entry.sources : [];
    const sources = rawSources.filter(
      (s): s is FontFamilySource =>
        typeof s === "string" && (FONT_SOURCE_VALUES as string[]).includes(s)
    );
    result.push({ family, count, primary_count: primaryCount, sources });
  }
  return result;
}

function parseImageMirrorMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const candidate = (value as Record<string, unknown>).image_mirror_map;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [remoteUrl, storagePath] of Object.entries(candidate)) {
    if (typeof remoteUrl === "string" && typeof storagePath === "string" && storagePath.length > 0) {
      result[remoteUrl] = storagePath;
    }
  }
  return result;
}

export async function getCompanyDetailFromDb(
  supabase: PirolDb,
  companyId: string
): Promise<CompanyDetail | null> {
  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select(
      "id, name, domain, markets, subscribed_since, deleted_at, logo_storage_path, logo_source, logo_confidence, logo_stale, company_inboxes(id, email_address, is_primary, created_at), company_email_stats(email_count, last_received_at)"
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
      .select(EMAIL_LIST_COLUMNS)
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

  const [resolvedCompany] = await resolveCompanyLogos([rowToCompany(companyRow)]);

  return {
    ...resolvedCompany,
    recentEmails: (emailRows ?? []).map(rowToCapturedEmail),
    emailCount: count ?? 0
  };
}

/**
 * Patches the editable fields on a company (name / domain / markets).
 *
 * Only the keys provided in `updates` are touched, so callers can ship
 * partial edits from the admin UI without round-tripping the entire
 * record. Domain is normalised to lower-case to keep the
 * `companies_domain_unique` index happy — the same normalisation we do on
 * insert in `createCompanySubscriptionInDb`. Markets are lower-cased,
 * trimmed, and de-duplicated; an empty list clears the company's
 * categorisation entirely.
 *
 * Throws `CompanyNotFoundError` if the row is missing or already
 * soft-deleted. Postgres unique-violation errors (code `23505`) bubble up
 * unchanged so the API layer can surface a helpful "domain already taken"
 * message.
 */
export async function updateCompanyInDb(
  supabase: PirolDb,
  companyId: string,
  updates: { name?: string; domain?: string; markets?: string[] }
): Promise<CompanySubscription> {
  const patch: { name?: string; domain?: string; markets?: string[] } = {};

  if (typeof updates.name === "string") {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      throw new Error("Name cannot be empty");
    }
    patch.name = trimmed;
  }

  if (typeof updates.domain === "string") {
    const trimmed = updates.domain.trim().toLowerCase();
    if (!trimmed) {
      throw new Error("Domain cannot be empty");
    }
    patch.domain = trimmed;
  }

  if (updates.markets !== undefined) {
    patch.markets = normalizeMarkets(updates.markets);
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields provided to update");
  }

  const { data, error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", companyId)
    .is("deleted_at", null)
    .select(
      "id, name, domain, markets, subscribed_since, logo_storage_path, logo_source, logo_confidence, logo_stale, company_inboxes(id, email_address, is_primary, created_at), company_email_stats(email_count, last_received_at)"
    )
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new CompanyNotFoundError(companyId);
  }

  const [resolved] = await resolveCompanyLogos([rowToCompany(data)]);
  return resolved;
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

type CompanyInboxRow = {
  id: string;
  email_address: string;
  is_primary: boolean;
  created_at: string;
};

type CompanyRow = {
  id: string;
  name: string;
  domain: string;
  markets: string[] | null;
  subscribed_since: string;
  logo_storage_path?: string | null;
  logo_source?: string | null;
  logo_confidence?: number | string | null;
  logo_stale?: boolean | null;
  company_inboxes?: CompanyInboxRow[] | null;
  company_email_stats?: CompanyStatsRow | CompanyStatsRow[] | null;
};

/**
 * Sort inboxes for display: primary first, then by creation time
 * (oldest first) so the "original" subscription address sits at the top
 * and any additional inboxes added later appear below in the order they
 * were created.
 */
function sortInboxesForDisplay(rows: CompanyInboxRow[]): CompanyInbox[] {
  return [...rows]
    .sort((a, b) => {
      if (a.is_primary !== b.is_primary) {
        return a.is_primary ? -1 : 1;
      }
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .map((row) => ({
      id: row.id,
      emailAddress: row.email_address,
      isPrimary: row.is_primary,
      createdAt: row.created_at
    }));
}

const LOGO_SOURCE_VALUES: readonly CompanySubscription["logoSource"][] = [
  "email_heuristic",
  "email_frequency",
  "manual"
];

function normalizeLogoSource(value: string | null | undefined): CompanySubscription["logoSource"] {
  if (typeof value !== "string") {
    return null;
  }
  return (LOGO_SOURCE_VALUES as readonly (string | null)[]).includes(value)
    ? (value as CompanySubscription["logoSource"])
    : null;
}

/**
 * Batch-signs the storage paths of every email-sourced logo, then returns
 * the company list with `logoUrl` set to the short-lived signed URL.
 */
async function resolveCompanyLogos(
  companies: CompanySubscription[]
): Promise<CompanySubscription[]> {
  const storagePathsByCompanyId = new Map<string, string>();
  for (const company of companies) {
    const storagePath = (company as CompanyWithRawLogo).__logoStoragePath;
    if (storagePath) {
      storagePathsByCompanyId.set(company.id, storagePath);
    }
  }

  const allPaths = Array.from(new Set(storagePathsByCompanyId.values()));
  const signed =
    allPaths.length > 0
      ? await getSignedAssets(allPaths, { transform: BRAND_LOGO_TRANSFORM })
      : {};

  return companies.map((company) => {
    const raw = company as CompanyWithRawLogo;
    const logoUrl =
      raw.__logoStoragePath && signed[raw.__logoStoragePath]
        ? signed[raw.__logoStoragePath]
        : null;
    return {
      id: company.id,
      name: company.name,
      domain: company.domain,
      markets: company.markets,
      subscriptionEmail: company.subscriptionEmail,
      inboxes: company.inboxes,
      subscribedAt: company.subscribedAt,
      emailCount: company.emailCount,
      lastEmailAt: company.lastEmailAt,
      logoUrl,
      logoSource: company.logoSource,
      logoConfidence: company.logoConfidence,
      logoStale: company.logoStale,
      needsLogoReview: company.needsLogoReview
    };
  });
}

/** Helper type used to thread the raw logo storage path through the row
 * mapper without exposing it on the public CompanySubscription contract. */
type CompanyWithRawLogo = CompanySubscription & {
  __logoStoragePath?: string | null;
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
  esp_provider: string | null;
  esp_confidence: number | string | null;
  preheader: string | null;
  has_gif: boolean | null;
  has_dark_mode: boolean | null;
  discount_percent: number | string | null;
  discount_amount: number | string | null;
  currency: string | null;
  promo_code: string | null;
  primary_cta_text: string | null;
  primary_cta_url: string | null;
  companies: { id: string; name: string } | { id: string; name: string }[] | null;
};

function rowToCompany(row: CompanyRow): CompanySubscription {
  const inboxes = sortInboxesForDisplay(row.company_inboxes ?? []);
  const primaryInbox =
    inboxes.find((inbox) => inbox.isPrimary)?.emailAddress ?? "unassigned@pirol.app";
  const stats = relationFirst(row.company_email_stats);
  const logoSource = normalizeLogoSource(row.logo_source);
  const logoStoragePath = row.logo_storage_path ?? null;
  const logoConfidence =
    row.logo_confidence === null || row.logo_confidence === undefined
      ? null
      : Number(row.logo_confidence);
  const logoStale = row.logo_stale ?? false;
  // A logo needs review when it's an admin's manual pick that has gone stale
  // (brand stopped sending it), OR it's a non-manual pick that is missing or
  // below the confidence floor — where the picker drifts onto QR codes / blanks.
  const needsLogoReview =
    logoStale ||
    (logoSource !== "manual" &&
      (logoStoragePath === null ||
        logoConfidence === null ||
        logoConfidence < LOGO_REVIEW_MAX_CONFIDENCE));
  const base: CompanyWithRawLogo = {
    id: row.id,
    name: row.name,
    domain: row.domain,
    markets: normalizeStoredMarkets(row.markets),
    subscriptionEmail: primaryInbox,
    inboxes,
    subscribedAt: row.subscribed_since,
    emailCount: stats?.email_count ?? 0,
    lastEmailAt: stats?.last_received_at ?? null,
    logoUrl: null,
    logoSource,
    logoConfidence,
    logoStale,
    needsLogoReview,
    __logoStoragePath: logoStoragePath
  };
  return base;
}

/**
 * Sanitises an incoming list of market tags before we write it back to
 * `companies.markets`. Tags are trimmed, lower-cased, de-duplicated, and
 * empty strings are dropped. Anything that isn't a string is filtered out
 * so a malformed payload can't sneak garbage past the API layer.
 */
function normalizeMarkets(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim().toLowerCase();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/**
 * Defensive read for the array we get back from Postgres. The column is
 * `text[] not null default '{}'`, so under normal conditions this is just
 * `row.markets ?? []` — but we still strip out any non-string entries
 * defensively in case a hand-edited row contains garbage.
 */
function normalizeStoredMarkets(input: string[] | null | undefined): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
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
    classificationConfidence: Number(row.classification_confidence ?? 0),
    espProvider: (row.esp_provider as EspProvider | null) ?? null,
    espConfidence: row.esp_confidence === null || row.esp_confidence === undefined
      ? null
      : Number(row.esp_confidence),
    preheader: row.preheader ?? null,
    hasGif: row.has_gif ?? false,
    hasDarkMode: row.has_dark_mode ?? false,
    discountPercent: row.discount_percent === null || row.discount_percent === undefined
      ? null
      : Number(row.discount_percent),
    discountAmount: row.discount_amount === null || row.discount_amount === undefined
      ? null
      : Number(row.discount_amount),
    currency: row.currency ?? null,
    promoCode: row.promo_code ?? null,
    primaryCtaText: row.primary_cta_text ?? null,
    primaryCtaUrl: row.primary_cta_url ?? null
  };
}

function parseAuthResults(value: unknown): CapturedEmailDetail["authResults"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const v = candidate[key];
    return typeof v === "string" ? v : null;
  };
  return {
    spf: pick("spf"),
    dkim: pick("dkim"),
    dmarc: pick("dmarc")
  };
}

function parseListHeaders(value: unknown): CapturedEmailDetail["listHeaders"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const bool = (key: string): boolean =>
    typeof candidate[key] === "boolean" ? (candidate[key] as boolean) : false;
  const str = (key: string): string | null => {
    const v = candidate[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  return {
    has_list_unsubscribe: bool("has_list_unsubscribe"),
    unsubscribe_mailto: str("unsubscribe_mailto"),
    unsubscribe_url: str("unsubscribe_url"),
    has_one_click_post: bool("has_one_click_post"),
    list_id: str("list_id")
  };
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function createCompanySubscriptionInDb(
  supabase: PirolDb,
  input: {
    name: string;
    domain: string;
    markets?: string[];
  }
): Promise<CompanySubscription> {
  const normalizedName = input.name.trim();
  const normalizedDomain = input.domain.trim().toLowerCase();
  const marketsValue = normalizeMarkets(input.markets);

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
    .insert({ name: normalizedName, domain: normalizedDomain, markets: marketsValue })
    .select("id, name, domain, markets, subscribed_since")
    .single();

  if (companyError) {
    throw companyError;
  }

  const { data: inboxRow, error: inboxError } = await supabase
    .from("company_inboxes")
    .insert({
      company_id: company.id,
      email_address: subscriptionEmail,
      is_primary: true
    })
    .select("id, email_address, is_primary, created_at")
    .single();

  if (inboxError) {
    throw inboxError;
  }

  // Logos are populated lazily by the ingest pipeline once we have email
  // content for the brand. Until the first email lands the UI renders a
  // tasteful monogram fallback derived from the company name.
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    markets: normalizeStoredMarkets(company.markets),
    subscriptionEmail,
    inboxes: [
      {
        id: inboxRow.id,
        emailAddress: inboxRow.email_address,
        isPrimary: inboxRow.is_primary,
        createdAt: inboxRow.created_at
      }
    ],
    subscribedAt: company.subscribed_since,
    emailCount: 0,
    lastEmailAt: null,
    logoUrl: null,
    logoSource: null,
    logoConfidence: null,
    logoStale: false,
    // Brand-new company has no logo yet — it needs a pick once email lands.
    needsLogoReview: true
  };
}

/**
 * Adds an additional (non-primary) inbox to an existing company. Useful
 * when a brand runs multiple mailing lists (e.g. men / women / press)
 * and Pirol wants to keep all of them attributed to the same company
 * record without having to create a duplicate `companies` row.
 *
 * The address is generated by `buildUniqueSubscriptionEmail`, which
 * appends a numeric suffix when the auto-generated `<slug>-<date>` form
 * already exists. The new inbox is always inserted with
 * `is_primary = false` so the per-company partial unique index on
 * `is_primary = true` is preserved.
 *
 * Throws when the company is missing or soft-deleted so the API layer
 * can translate the failure to a 404 instead of silently producing an
 * orphaned inbox.
 */
export async function addCompanyInboxInDb(
  supabase: PirolDb,
  companyId: string
): Promise<CompanyInbox> {
  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select("id, name, deleted_at")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) {
    throw companyError;
  }

  if (!companyRow || companyRow.deleted_at) {
    throw new CompanyNotFoundError(companyId);
  }

  const { data: existingInboxes, error: inboxesError } = await supabase
    .from("company_inboxes")
    .select("email_address");

  if (inboxesError) {
    throw inboxesError;
  }

  const emailAddress = buildUniqueSubscriptionEmail(
    companyRow.name,
    (existingInboxes ?? []).map((item) => item.email_address)
  );

  const { data: inboxRow, error: insertError } = await supabase
    .from("company_inboxes")
    .insert({
      company_id: companyRow.id,
      email_address: emailAddress,
      is_primary: false
    })
    .select("id, email_address, is_primary, created_at")
    .single();

  if (insertError) {
    throw insertError;
  }

  return {
    id: inboxRow.id,
    emailAddress: inboxRow.email_address,
    isPrimary: inboxRow.is_primary,
    createdAt: inboxRow.created_at
  };
}

/**
 * Distinct error type so the API layer can map "company missing /
 * soft-deleted" to a 404 without string-matching on a generic Error.
 */
export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company ${companyId} not found or has been deleted`);
    this.name = "CompanyNotFoundError";
  }
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
    discountPercent?: number | null;
    discountAmount?: number | null;
    currency?: string | null;
    promoCode?: string | null;
    primaryCtaText?: string | null;
    primaryCtaUrlHint?: string | null;
    detectedCountry?: string | null;
    countryConfidence?: number | null;
    countrySignals?: unknown;
  };
  enrichment?: {
    espProvider?: string | null;
    espConfidence?: number | null;
    espSignals?: unknown;
    preheader?: string | null;
    hasGif?: boolean | null;
    hasDarkMode?: boolean | null;
    primaryCtaUrl?: string | null;
    authResults?: unknown;
    listHeaders?: unknown;
    metadata?: unknown;
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

  const enrichment = input.enrichment ?? {};

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
      processed_at: new Date().toISOString(),
      esp_provider: enrichment.espProvider ?? null,
      esp_confidence: enrichment.espConfidence ?? null,
      esp_signals: (enrichment.espSignals ?? null) as Json | null,
      preheader: enrichment.preheader ?? null,
      has_gif: enrichment.hasGif ?? false,
      has_dark_mode: enrichment.hasDarkMode ?? false,
      discount_percent: input.classification.discountPercent ?? null,
      discount_amount: input.classification.discountAmount ?? null,
      currency: input.classification.currency ?? null,
      promo_code: input.classification.promoCode ?? null,
      primary_cta_text: input.classification.primaryCtaText ?? null,
      primary_cta_url: enrichment.primaryCtaUrl ?? null,
      detected_country: input.classification.detectedCountry ?? null,
      country_confidence: input.classification.countryConfidence ?? null,
      country_signals: (input.classification.countrySignals ?? null) as Json | null,
      auth_results: (enrichment.authResults ?? null) as Json | null,
      list_headers: (enrichment.listHeaders ?? null) as Json | null,
      metadata: ((enrichment.metadata ?? {}) as Json) ?? ({} as Json)
    })
    .select("id")
    .single();

  if (emailError) {
    throw emailError;
  }

  return { id: email.id, deduplicated: false };
}
