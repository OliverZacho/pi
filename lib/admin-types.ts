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

export type CompanySubscription = {
  id: string;
  name: string;
  domain: string;
  market: string | null;
  subscriptionEmail: string;
  subscribedAt: string;
  emailCount: number;
  lastEmailAt: string | null;
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
  | "agillic";

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
  paletteColors: PaletteColor[];
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
