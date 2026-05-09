export type EmailCategory =
  | "sale"
  | "product_launch"
  | "event"
  | "content"
  | "loyalty"
  | "transactional"
  | "seasonal"
  | "partnership"
  | "company_news"
  | "other";

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
  | "mailjet";

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

export type CapturedEmailDetail = CapturedEmail & {
  recipient: string;
  htmlSignedUrl: string | null;
  imageSignedUrls: { storagePath: string; signedUrl: string }[];
  remoteImageUrls: string[];
  llmModel: string | null;
  llmReasoning: string | null;
  processedAt: string | null;
  authResults: { spf: string | null; dkim: string | null; dmarc: string | null } | null;
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
