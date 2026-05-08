import type { EmailCategory } from "./admin-types";

const PIROL_DOMAIN = "pirol.app";

export function normalizeCompanyName(companyName: string): string {
  return companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildUniqueSubscriptionEmail(
  companyName: string,
  existingEmails: string[],
  now = new Date()
): string {
  const base = normalizeCompanyName(companyName) || "company";
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate()
  ).padStart(2, "0")}`;

  let candidate = `${base}-${date}@${PIROL_DOMAIN}`;
  let i = 1;
  while (existingEmails.includes(candidate)) {
    candidate = `${base}-${date}-${i}@${PIROL_DOMAIN}`;
    i += 1;
  }
  return candidate;
}

export function classifyFromRules(subject: string, html: string): {
  category: EmailCategory;
  confidence: number;
} {
  const haystack = `${subject} ${html}`.toLowerCase();
  if (/\bnew launch\b|\bnew product\b|\bintroducing\b|\bnow available\b/.test(haystack)) {
    return { category: "new_launch", confidence: 0.88 };
  }
  if (/\bsale\b|\bdiscount\b|\b\d{1,2}%\s*off\b|\bpromo\b|\bdeal\b/.test(haystack)) {
    return { category: "sale", confidence: 0.88 };
  }
  if (/\blaunch\b|\bdebut\b/.test(haystack)) {
    return { category: "new_launch", confidence: 0.78 };
  }
  if (/\boffer\b/.test(haystack)) {
    return { category: "sale", confidence: 0.74 };
  }
  if (/\bwebinar\b|\bevent\b|\bregister\b/.test(haystack)) {
    return { category: "event", confidence: 0.73 };
  }
  if (/\bupdate\b|\brelease notes\b|\bchangelog\b/.test(haystack)) {
    return { category: "product_update", confidence: 0.71 };
  }
  if (/\bnewsletter\b|\bweekly\b|\bmonthly\b/.test(haystack)) {
    return { category: "newsletter", confidence: 0.68 };
  }
  return { category: "other", confidence: 0.45 };
}

export function extractImageUrlsFromHtml(html: string): string[] {
  const matches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
  return matches.map((m) => m[1]).filter(Boolean);
}
