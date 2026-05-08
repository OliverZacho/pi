export type EmailCategory =
  | "new_launch"
  | "sale"
  | "newsletter"
  | "product_update"
  | "event"
  | "other";

export type ClassificationSource = "rules" | "llm" | "manual";

export type CompanySubscription = {
  id: string;
  name: string;
  domain: string;
  subscriptionEmail: string;
  subscribedAt: string;
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
