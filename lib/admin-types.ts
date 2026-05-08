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
};

export type CapturedEmailDetail = CapturedEmail & {
  recipient: string;
  htmlSignedUrl: string | null;
  imageSignedUrls: { storagePath: string; signedUrl: string }[];
  remoteImageUrls: string[];
  llmModel: string | null;
  llmReasoning: string | null;
  processedAt: string | null;
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
