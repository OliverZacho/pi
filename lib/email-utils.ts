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

  if (/\breceipt\b|\border\s*#?\s*\d+\b|\border confirmation\b|\bpayment received\b|\bshipping confirmation\b|\binvoice\b/.test(haystack)) {
    return { category: "transactional", confidence: 0.9 };
  }

  if (/\bblack friday\b|\bcyber monday\b|\bchristmas\b|\bxmas\b|\bholiday sale\b|\bvalentine'?s\b|\bhalloween\b|\beaster\b|\bnew year'?s sale\b|\bsummer sale\b/.test(haystack)) {
    return { category: "seasonal", confidence: 0.9 };
  }

  if (/\bsale\b|\bdiscount\b|\b\d{1,2}%\s*off\b|\bpromo(?:tion|tional)?\b|\bdeal\b|\bcoupon\b|\bspecial offer\b/.test(haystack)) {
    return { category: "sale", confidence: 0.88 };
  }

  if (/\bintroducing\b|\bnew product\b|\bnow available\b|\bnew launch\b|\bjust launched\b|\bnewly launched\b|\bnew release\b|\bnow live\b|\bdebut\b|\bunveil(?:ing|ed)?\b|\bmeet the new\b/.test(haystack)) {
    return { category: "product_launch", confidence: 0.85 };
  }

  if (/\bwelcome to\b|\bthanks for (?:signing up|subscribing|joining)\b|\bthank you for (?:signing up|subscribing|joining)\b|\bconfirm your (?:email|subscription)\b|\bdouble opt-?in\b|\byou'?re (?:in|subscribed)\b|\bgetting started\b|\bglad you'?re here\b/.test(haystack)) {
    return { category: "welcome", confidence: 0.85 };
  }

  if (
    /\bshop (?:the |our )?(?:collection|edit|drop|range|lineup|new[- ]?ins?)\b|\bnew arrivals?\b|\bbestsellers?\b|\brestock(?:ed)?\b|\bback in stock\b|\block ?book\b|\bgift guide\b|\bfeatured products?\b|\bour (?:latest|newest) (?:styles|pieces|drop|arrivals)\b|\bshop now\b|\bshop the (?:look|edit)\b|\bnew[- ]?in\b/.test(haystack)
  ) {
    return { category: "products", confidence: 0.78 };
  }

  if (/\bwebinar\b|\bevent\b|\binvit(?:e|ation)\b|\brsvp\b|\bregister now\b|\bjoin us\b|\bsave the date\b|\bworkshop\b|\bconference\b/.test(haystack)) {
    return { category: "event", confidence: 0.82 };
  }

  if (/\brewards?\b|\bloyalty\b|\bmember(?:s|ship)?\b|\bwe miss you\b|\bcome back\b|\bwelcome back\b|\bredeem points?\b|\bvip\b/.test(haystack)) {
    return { category: "loyalty", confidence: 0.78 };
  }

  if (/\bcollaboration\b|\bcollab\b|\bpartnership\b|\bpartner(?:ing)?\s+with\b|\bteam(?:ed|ing)?\s+up\b/.test(haystack)) {
    return { category: "partnership", confidence: 0.78 };
  }

  if (/\bmilestone\b|\brebrand\b|\b(?:we'?re|now)\s+hiring\b|\bjoin our team\b|\bwe'?re now\b|\bcompany update\b|\bfunding round\b|\bseries [a-z]\b|\bacquisition\b/.test(haystack)) {
    return { category: "company_news", confidence: 0.78 };
  }

  if (/\bsurvey\b|\bfeedback\b|\bshare your (?:thoughts|feedback|opinion|experience)\b|\btell us (?:what|how|about)\b|\brate your (?:experience|order|stay|visit)\b|\bnet promoter\b|\bnps\b|\bwe'?d love your feedback\b|\bhelp us improve\b|\byour opinion matters\b|\btake (?:our|the|a) (?:short |quick )?survey\b/.test(haystack)) {
    return { category: "survey", confidence: 0.8 };
  }

  if (/\bhow to\b|\bhow-to\b|\bstep[- ]by[- ]step\b|\btutorial\b|\brecipes?\b|\bwalk[- ]?through\b|\bbeginner'?s guide\b|\blearn how\b|\blearn to\b|\btips (?:for|and tricks)\b|\bproduct academy\b|\btraining course\b|\bcertification\b|\bexplainer\b/.test(haystack)) {
    return { category: "education", confidence: 0.78 };
  }

  if (/\blaunch\b/.test(haystack)) {
    return { category: "product_launch", confidence: 0.72 };
  }

  if (/\boffer\b/.test(haystack)) {
    return { category: "sale", confidence: 0.7 };
  }

  if (/\bnewsletter\b|\bweekly digest\b|\bmonthly digest\b|\bedition\b|\bissue #?\d+\b|\bread more\b|\bour story\b|\binsights?\b/.test(haystack)) {
    return { category: "content", confidence: 0.65 };
  }

  return { category: "other", confidence: 0.45 };
}

export function extractImageUrlsFromHtml(html: string): string[] {
  const matches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
  return matches.map((m) => m[1]).filter(Boolean);
}
