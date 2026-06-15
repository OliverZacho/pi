export type EmailCategory =
  | "sale"
  | "product_launch"
  | "products"
  | "event"
  | "content"
  | "education"
  | "loyalty"
  | "welcome"
  | "transactional"
  | "seasonal"
  | "partnership"
  | "company_news"
  | "survey"
  | "other";

export const EMAIL_CATEGORIES: readonly EmailCategory[] = [
  "sale",
  "product_launch",
  "products",
  "event",
  "content",
  "education",
  "loyalty",
  "welcome",
  "transactional",
  "seasonal",
  "partnership",
  "company_news",
  "survey",
  "other"
] as const;

export const EMAIL_CATEGORY_LABELS: Record<EmailCategory, string> = {
  sale: "Sale",
  product_launch: "Product launch",
  products: "Products",
  event: "Event",
  content: "Editorial",
  education: "Education",
  loyalty: "Loyalty",
  welcome: "Welcome",
  transactional: "Transactional",
  seasonal: "Seasonal",
  partnership: "Partnership",
  company_news: "Company news",
  survey: "Survey",
  other: "Other"
};

export type ClassificationSource = "rules" | "llm" | "manual";

export type CompanyLogoSource = "email_heuristic" | "email_frequency" | "manual";

/**
 * A single Pirol-side inbox address a company is subscribed under. A
 * company can have many of these (for example one for men's mailing list
 * and one for women's), but only one can be marked `isPrimary` — enforced
 * by a partial unique index in the database.
 */
export type CompanyInbox = {
  id: string;
  emailAddress: string;
  isPrimary: boolean;
  createdAt: string;
  /**
   * Subscription "segment" this inbox represents. A brand can run several
   * lists sliced by product line and/or country; tagging the inbox lets the
   * brand page offer a per-segment switcher and lets Explore filter
   * precisely (a furniture-segment email no longer surfaces under a
   * jewellery filter). All three are null for an un-segmented inbox.
   */
  segmentLabel: string | null;
  /** Product-line tag, lower-cased to match `companies.markets`. */
  segmentCategory: string | null;
  /** ISO 3166-1 alpha-2 (uppercase) when the list is country-specific. */
  segmentCountry: string | null;
};

export type MarketCitation = {
  reasoning: string | null;
  sources: { title: string | null; url: string }[];
};

export type CompanySubscription = {
  id: string;
  name: string;
  domain: string;
  /**
   * Every market / category tag the operator has tagged this brand with
   * (e.g. `["fashion", "ecommerce"]`). Always lower-cased — the UI is
   * responsible for prettifying for display. Empty array when the brand
   * is uncategorised.
   */
  markets: string[];
  /** Resolved primary market (ISO alpha-2) or null when unknown. */
  primaryMarketCountry: string | null;
  /** True for genuine global brands (still carry an HQ country). */
  isGlobal: boolean;
  /** Web-resolved HQ country (ISO alpha-2); usually equals primaryMarketCountry. */
  hqCountry: string | null;
  /** How the market was resolved: email rollup, web lookup, or a manual override. */
  marketSource: "email" | "web" | "manual" | null;
  /** Audit payload for a web-resolved market (admin-only surfacing). */
  marketCitation: MarketCitation | null;
  /**
   * Primary inbox email — kept for backwards compatibility and for the
   * many UI surfaces that only need to display one address. For
   * brand-level views, prefer `inboxes` (sorted with primary first).
   */
  subscriptionEmail: string;
  /**
   * Every inbox attached to the company, primary first then by creation
   * time. Multiple inboxes are useful when a brand operates separate
   * mailing lists (e.g. men / women / press) and we want to keep them
   * all attributed to the same company record.
   */
  inboxes: CompanyInbox[];
  /**
   * Admin-curated allowlist flag (`companies.is_curated`). When true the
   * brand's emails surface in Explore's default "Recommended" feed — a
   * filter disguised as a sort that shows only hand-picked brands, newest
   * first.
   */
  isCurated: boolean;
  subscribedAt: string;
  emailCount: number;
  lastEmailAt: string | null;
  /**
   * Short-lived signed URL into the `email-assets` bucket for a logo we
   * extracted from one of the brand's emails. `null` until the first
   * email lands and a candidate clears the heuristic threshold — in that
   * case the UI renders a monogram fallback.
   */
  logoUrl: string | null;
  logoSource: CompanyLogoSource | null;
  /**
   * Confidence of the stored logo pick (0–1). `null` when no logo is set.
   * Heuristic picks score `points / 150`; frequency picks score
   * `appearances / sampledEmails`. Drives the review queue.
   */
  logoConfidence: number | null;
  /**
   * True when a `manual` logo pick has fallen out of the brand's recent
   * emails (likely a rebrand) and should be reviewed again. Drives the
   * "may be outdated" review reason.
   */
  logoStale: boolean;
  /**
   * True when the logo needs an admin's eyes: a non-`manual` pick that is
   * either missing or below {@link LOGO_REVIEW_MAX_CONFIDENCE}, OR a manual
   * pick that has gone {@link logoStale}.
   */
  needsLogoReview: boolean;
};

export type EspProvider =
  | "mailchimp"
  | "klaviyo"
  | "hubspot"
  | "sendgrid"
  | "braze"
  | "iterable"
  | "customerio"
  | "salesforce_mc"
  | "marketo"
  | "omnisend"
  | "activecampaign"
  | "constantcontact"
  | "drip"
  | "attentive"
  | "sendinblue"
  | "shopify_email"
  | "substack"
  | "beehiiv"
  | "convertkit"
  | "mailerlite"
  | "mailgun"
  | "postmark"
  | "amazon_ses"
  | "mailjet"
  | "apsis"
  | "agillic"
  | "peytzmail"
  | "pure360"
  | "heyloyalty"
  | "exponea"
  | "voyado"
  | "emarsys"
  | "dynamics_365";

/**
 * Canonical user-facing labels for each ESP provider id. Shared between
 * the brand dashboard, the brands explorer and the email modal so a
 * single rename here propagates everywhere we surface ESPs.
 */
export const ESP_LABELS: Record<EspProvider, string> = {
  mailchimp: "Mailchimp",
  klaviyo: "Klaviyo",
  hubspot: "HubSpot",
  sendgrid: "SendGrid",
  braze: "Braze",
  iterable: "Iterable",
  customerio: "Customer.io",
  salesforce_mc: "Salesforce MC",
  marketo: "Marketo",
  omnisend: "Omnisend",
  activecampaign: "ActiveCampaign",
  constantcontact: "Constant Contact",
  drip: "Drip",
  attentive: "Attentive",
  sendinblue: "Brevo / Sendinblue",
  shopify_email: "Shopify Email",
  substack: "Substack",
  beehiiv: "beehiiv",
  convertkit: "ConvertKit / Kit",
  mailerlite: "MailerLite",
  mailgun: "Mailgun",
  postmark: "Postmark",
  amazon_ses: "Amazon SES",
  mailjet: "Mailjet",
  apsis: "APSIS / Efficy",
  agillic: "Agillic",
  peytzmail: "Peytzmail",
  pure360: "Pure360 / Spotler",
  heyloyalty: "HeyLoyalty",
  exponea: "Bloomreach / Exponea",
  voyado: "Voyado",
  emarsys: "SAP Emarsys",
  dynamics_365: "Dynamics 365"
};

export type CapturedEmail = {
  id: string;
  companyId: string | null;
  companyName: string;
  sender: string;
  subject: string;
  sentAt: string;
  receivedAt: string;
  html: string;
  imageUrls: string[];
  category: EmailCategory;
  subcategory: string | null;
  classificationSource: ClassificationSource;
  classificationConfidence: number;
  espProvider: EspProvider | null;
  espConfidence: number | null;
  preheader: string | null;
  hasGif: boolean;
  hasDarkMode: boolean;
  discountPercent: number | null;
  discountAmount: number | null;
  currency: string | null;
  promoCode: string | null;
  primaryCtaText: string | null;
  primaryCtaUrl: string | null;
};

export type PaletteColorSource = "inline" | "style_block" | "attribute";

export type PaletteColor = {
  hex: string;
  count: number;
  sources: PaletteColorSource[];
};

export type FontFamilySource = "inline" | "style_block" | "attribute";

export type FontFamily = {
  family: string;
  /** Total `font-family` declarations the name appears in (any stack position). */
  count: number;
  /**
   * How often the font was the *first non-generic* entry of its declaration
   * — i.e. the typeface the author actually wanted to render. Fallbacks (e.g.
   * Arial trailing every stack) have a high `count` but `primary_count: 0`.
   */
  primary_count: number;
  sources: FontFamilySource[];
};

/**
 * Bulk-sender / mailing-list disclosure header signals (`List-Unsubscribe`,
 * `List-Unsubscribe-Post`, `List-Id`). Mirrors `lib/extract-metadata.ts`'s
 * `ListHeaders` type so the admin layer doesn't depend on the extractor.
 *
 * `null` at the field level means we never had headers to inspect (legacy /
 * pre-feature rows). A populated object with everything `false` / `null`
 * means we *did* see headers and these specific signals were genuinely
 * absent — that's the case worth flagging because it's what hurts inbox
 * placement and removes Apple Mail's built-in Unsubscribe button.
 */
export type ListHeaders = {
  has_list_unsubscribe: boolean;
  unsubscribe_mailto: string | null;
  unsubscribe_url: string | null;
  has_one_click_post: boolean;
  list_id: string | null;
};

/**
 * Cross-checks the three independent pieces that together make up "modern"
 * unsubscribe support, so the UI can spell out which inputs are present and
 * which are missing instead of collapsing it to a single boolean.
 *
 * The pieces are:
 *
 *  1. A non-empty `List-Unsubscribe` header (RFC 2369). Drives Apple Mail's
 *     built-in Unsubscribe button. A `mailto:` URI alone is enough for the
 *     button — this is the older mechanism.
 *  2. An `https://` URI inside `List-Unsubscribe`. Required by RFC 8058 —
 *     the one-click POST has to have somewhere to POST to.
 *  3. `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Tells mailbox
 *     providers the URL above accepts a single POST with no user
 *     confirmation, and signals to anti-spam scanners that GET requests
 *     should not be treated as unsubscribes.
 *
 * Gmail / Yahoo's 2024 bulk-sender rules require *all three*. Apple Mail
 * only needs the first. A mailto-only `List-Unsubscribe` is still a valid
 * RFC 2369 header but is *not* RFC 8058 one-click; some senders include
 * both alongside the https URL for old clients, but mailto on its own does
 * not satisfy Gmail / Yahoo's 2024 requirements.
 */
export type ListHeadersComplianceLevel =
  | "unknown"
  | "missing"
  | "mailto_only"
  | "missing_post_header"
  | "missing_https_url"
  | "compliant";

export type ListHeadersCompliance = {
  level: ListHeadersComplianceLevel;
  /** Plain-English explanation suitable for direct rendering in the UI. */
  summary: string;
  /** True iff Apple Mail will surface its built-in Unsubscribe button. */
  apple_mail_button: boolean;
  /** True iff Gmail / Yahoo's 2024 bulk-sender rules (RFC 8058) are met. */
  gmail_yahoo_one_click: boolean;
};

export function classifyListHeaders(
  headers: ListHeaders | null
): ListHeadersCompliance {
  if (!headers) {
    return {
      level: "unknown",
      summary: "No header snapshot was captured for this email yet.",
      apple_mail_button: false,
      gmail_yahoo_one_click: false
    };
  }

  if (!headers.has_list_unsubscribe) {
    return {
      level: "missing",
      summary:
        "No List-Unsubscribe header at all — Apple Mail will not show its built-in Unsubscribe button, and Gmail / Yahoo's 2024 bulk-sender rules are not satisfied.",
      apple_mail_button: false,
      gmail_yahoo_one_click: false
    };
  }

  if (headers.unsubscribe_url && headers.has_one_click_post) {
    return {
      level: "compliant",
      summary:
        "RFC 8058 one-click compliant — Apple Mail's Unsubscribe button will appear and Gmail / Yahoo's 2024 bulk-sender rules are met.",
      apple_mail_button: true,
      gmail_yahoo_one_click: true
    };
  }

  if (headers.unsubscribe_url) {
    return {
      level: "missing_post_header",
      summary:
        "Has an https URL but no List-Unsubscribe-Post: List-Unsubscribe=One-Click header. Apple Mail will show its button, but anti-spam scanners can accidentally GET the URL and unsubscribe the recipient, and Gmail / Yahoo's 2024 bulk-sender rules require the post header for full one-click compliance.",
      apple_mail_button: true,
      gmail_yahoo_one_click: false
    };
  }

  if (headers.has_one_click_post) {
    return {
      level: "missing_https_url",
      summary:
        "Has a List-Unsubscribe-Post one-click signal but no https URL inside List-Unsubscribe to POST to — this configuration is malformed and mailbox providers will ignore the one-click signal.",
      apple_mail_button: true,
      gmail_yahoo_one_click: false
    };
  }

  return {
    level: "mailto_only",
    summary:
      "Mailto-only List-Unsubscribe (the older RFC 2369 mechanism). Apple Mail will show its Unsubscribe button, but Gmail / Yahoo's 2024 bulk-sender rules expect an https URL plus a List-Unsubscribe-Post: List-Unsubscribe=One-Click header — mailto is still tolerated but is not RFC 8058 one-click.",
    apple_mail_button: true,
    gmail_yahoo_one_click: false
  };
}

export type CapturedEmailDetail = CapturedEmail & {
  recipient: string;
  htmlContent: string;
  htmlSignedUrl: string | null;
  imageSignedUrls: { storagePath: string; signedUrl: string }[];
  imageMirrorMap: Record<string, string>;
  remoteImageUrls: string[];
  llmModel: string | null;
  llmReasoning: string | null;
  processedAt: string | null;
  authResults: { spf: string | null; dkim: string | null; dmarc: string | null } | null;
  listHeaders: ListHeaders | null;
  paletteColors: PaletteColor[];
  fontFamilies: FontFamily[];
  metadata: Record<string, unknown> | null;
  /**
   * The country this individual email was detected as addressed to (ISO
   * 3166-1 alpha-2), or `null` when unknown. Per-email and noisier than the
   * brand-level rollup — surfaced in the modal mainly to flag divergence.
   */
  detectedCountry: string | null;
  countryConfidence: number | null;
  /**
   * The owning brand's rolled-up {@link CompanySubscription} primary market,
   * carried here so the modal can highlight when this email's detected country
   * disagrees with it (a multi-market send, or a misdetection to review).
   */
  companyPrimaryMarketCountry: string | null;
  /**
   * The mailing lists this exact email was sent to. Populated only when the
   * brand fired the same content to several tagged inbox segments at once
   * (e.g. a welcome blast to Women / Men / Children / Homeware) — i.e. when
   * the de-dup grouping found more than one copy. Each entry is one segment;
   * `isCurrent` flags the copy this detail view was opened from. Empty for an
   * ordinary single send. See `captured_emails.duplicate_of`.
   */
  sentToLists: { inboxId: string | null; label: string; isCurrent: boolean }[];
};

export type AdminOverview = {
  companies: CompanySubscription[];
  emails: CapturedEmail[];
  categories: EmailCategory[];
  storageNotes: string;
  pagination: {
    nextCursor: string | null;
    pageSize: number;
  };
};

export type CompanyDetail = CompanySubscription & {
  recentEmails: CapturedEmail[];
  emailCount: number;
};

/**
 * One day in the cumulative growth series. `emails` and `brands` are running
 * totals (captured emails by received_at, subscribed brands by subscribed_since)
 * as of that UTC day. Served by `/api/admin/growth`.
 */
export type GrowthPoint = {
  day: string;
  emails: number;
  brands: number;
};

/**
 * Average send cadence for one category (a `companies.markets` tag, or the
 * `__uncategorized__` sentinel for untagged brands). Aggregated only over
 * brands with 5+ captured emails so the welcome-series burst of freshly
 * subscribed brands doesn't skew the cadence. `emailsPerWeek` and
 * `daysBetween` are both averages of the per-brand rate. Served by
 * `/api/admin/category-frequency`.
 */
export type CategoryFrequencyPoint = {
  category: string;
  brands: number;
  emailsPerWeek: number;
  daysBetween: number;
};

/**
 * Average send cadence for one (category, country) pair, where country is the
 * brand's resolved `primary_market_country` (ISO alpha-2) or the
 * `__unknown__` sentinel. Same 5+ captured-email filter and per-brand rate as
 * {@link CategoryFrequencyPoint}; lets the dashboard compare cadence between
 * countries inside a category. Served by
 * `/api/admin/category-country-frequency`.
 */
export type CategoryCountryFrequencyPoint = CategoryFrequencyPoint & {
  country: string;
};

/** The four Anthropic call sites we attribute spend to. */
export type UsageFeature = "classify" | "suggest" | "hq_lookup" | "vision";

/** User-facing labels for each Anthropic call site on the cost dashboard. */
export const USAGE_FEATURE_LABELS: Record<UsageFeature, string> = {
  classify: "Email classification",
  suggest: "Company suggestions",
  hq_lookup: "Brand HQ lookup",
  vision: "Product vision"
};

/**
 * Aggregated dashboard statistics, served by `/api/admin/stats` and computed in
 * a single Postgres call (`pirol_admin_dashboard_stats`). The Anthropic cost
 * rollup is the headline; the rest are operational health metrics. Cost numbers
 * only cover calls made since usage logging was added — see `trackingSince`.
 */
export type DashboardStats = {
  totals: { companies: number; emails: number };
  velocity: { emails7d: number; emails30d: number };
  brands: {
    total: number;
    active30d: number;
    top: { name: string; count: number }[];
  };
  categories: { category: EmailCategory; count: number }[];
  discount: { avgSaleDiscount: number | null; saleCountWithDiscount: number };
  /**
   * Catalog-cleanliness counters for the founder view — how much of the
   * dataset still needs attention. `lowConfidenceThreshold` is the shared
   * 0.5 floor (logo confidence + classification confidence) the SQL applies,
   * passed through so labels stay in sync with the query.
   */
  quality: {
    lowConfidenceThreshold: number;
    brandsUnknownMarket: number;
    logosNeedingReview: number;
    lowConfidenceEmails: number;
    /**
     * Captured emails with no matching company inbox (`company_id is null`) —
     * mail that arrived at an address we don't track (e.g. a deleted catch-all)
     * or that was never registered. Admin-only visibility.
     */
    unattributedEmails: number;
  };
  cost: {
    totalUsd: number;
    totalCalls: number;
    last30dUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    webSearchRequests: number;
    /** ISO timestamp of the first logged call, or null when nothing logged yet. */
    trackingSince: string | null;
    byFeature: { feature: UsageFeature; usd: number; calls: number }[];
    byModel: { model: string; usd: number; calls: number }[];
    daily14d: { day: string; usd: number }[];
  };
};

/**
 * One day in the cumulative user-growth series: running total of signed-up
 * users and of paid conversions as of that UTC day. Served (inside
 * {@link UserMetrics}) by `/api/admin/user-metrics`.
 */
export type UserGrowthPoint = {
  day: string;
  users: number;
  paid: number;
};

/**
 * One stage of the activation funnel. `count` is the number of (non-team) users
 * who reached that stage; stages are ordered widest → narrowest for display.
 */
export type FunnelStage = {
  key: string;
  label: string;
  count: number;
};

/**
 * Audience health for the admin "Users" tab, computed in a single Postgres call
 * (`pirol_admin_user_metrics`). Four lenses:
 *
 *  - **growth**   — signups over time and across tiers (free / paid / team).
 *  - **retention**— churn proxy from last-seen recency buckets.
 *  - **pmf**      — product-market-fit proxies (activation, stickiness, power users).
 *  - **funnel**   — the signup → paid activation funnel.
 *
 * Team accounts (admins) are excluded from `retention`, `pmf` and `funnel`
 * denominators so internal usage doesn't flatter the numbers; `totals` still
 * counts them separately. Rates are fractions in `[0, 1]` (or `null` when the
 * denominator is zero). Activity is measured off `user_profiles.last_active_at`,
 * the last app load — so recency buckets are "time since last seen".
 */
export type UserMetrics = {
  generatedAt: string;
  totals: { total: number; free: number; paid: number; admins: number };
  growth: {
    new30d: number;
    newPrev30d: number;
    /** (new30d − newPrev30d) / newPrev30d, or null when there's no prior base. */
    growthRate30d: number | null;
    series: UserGrowthPoint[];
  };
  retention: {
    realTotal: number;
    active7d: number;
    /** Last seen 8–30 days ago. */
    recent: number;
    /** Last seen 31–60 days ago. */
    atRisk: number;
    /** Last seen 60+ days ago, or never returned after signup. */
    dormant: number;
    /** Share of users not seen in 30 days — the engagement-churn proxy. */
    inactiveRate30d: number | null;
  };
  subscription: {
    active: number;
    canceled: number;
    churnRate: number | null;
  };
  pmf: {
    activated: number;
    activationRate: number | null;
    powerUsers: number;
    powerUserRate: number | null;
    dau: number;
    wau: number;
    mau: number;
    /** DAU / MAU — the canonical stickiness ratio. */
    stickiness: number | null;
  };
  funnel: FunnelStage[];
};
