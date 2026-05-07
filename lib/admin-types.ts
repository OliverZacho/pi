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
  companyId: string;
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

export type AdminOverview = {
  companies: CompanySubscription[];
  emails: CapturedEmail[];
  categories: EmailCategory[];
  storageNotes: string;
};
