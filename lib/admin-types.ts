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
  | "voyado";

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
  voyado: "Voyado"
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
