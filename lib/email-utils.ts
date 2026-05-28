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

// Markers that reliably indicate the start of an email's footer / unsubscribe /
// preferences / GDPR boilerplate. Everything from the *earliest* occurrence of
// any of these is excluded from rule matching, because that region is template
// chrome rather than campaign content and routinely contains tokens like
// "promotional newsletter", "special offer", "deal", "manage your preferences",
// etc. that have nothing to do with the email's actual purpose.
const FOOTER_MARKERS: RegExp[] = [
  /\bunsubscribe\b/,
  /\bto unsubscribe\b/,
  /\bif you no longer (?:wish|want) to receive\b/,
  /\byou (?:are|'re) receiving this (?:email|message|newsletter)\b/,
  /\byou received this (?:email|message|newsletter) because\b/,
  /\bmanage (?:your )?(?:email )?preferences\b/,
  /\bupdate (?:your )?(?:email )?preferences\b/,
  /\bemail preferences\b/,
  /\bnotification settings\b/,
  /\bwe comply with the gdpr\b/,
  /\bprivacy (?:policy|notice)\b/
];

function stripFooter(haystack: string): string {
  let cut = haystack.length;
  for (const marker of FOOTER_MARKERS) {
    const m = marker.exec(haystack);
    if (m && m.index < cut) cut = m.index;
  }
  return haystack.slice(0, cut);
}

export function classifyFromRules(subject: string, html: string): {
  category: EmailCategory;
  confidence: number;
} {
  const subjectLc = subject.toLowerCase();
  const fullHaystack = `${subjectLc} ${html.toLowerCase()}`;
  // Run rule matching against the footer-stripped haystack so unsubscribe /
  // preferences boilerplate ("our promotional newsletter", "manage your
  // preferences", etc.) can never trigger a category on its own.
  const haystack = stripFooter(fullHaystack);

  if (/\breceipt\b|\border\s*#?\s*\d+\b|\border confirmation\b|\bpayment received\b|\bshipping confirmation\b|\binvoice\b/.test(haystack)) {
    return { category: "transactional", confidence: 0.9 };
  }

  // Strong welcome/onboarding signals in the SUBJECT win over sale-style body
  // copy: many welcome emails ship a signup discount ("Welcome to BRAND — 10%
  // off your first order"), and we don't want those to be miscategorised as
  // `sale`. We also cover Scandinavian "velkommen til <brand>" / "välkommen
  // till" patterns because the dataset is heavily Nordic. The negative
  // lookahead on "welcome back" preserves loyalty re-engagement classification.
  if (
    /\bwelcome to\b|^welcome(?! back\b)|\bvelkommen til\b|\bvälkommen till\b|\bwillkommen bei\b|\bbienvenue (?:à|chez)\b|\bbienvenido a\b|\bthanks? for (?:signing up|subscribing|joining)\b|\bthank you for (?:signing up|subscribing|joining)\b|\bconfirm your (?:email|subscription)\b|\bdouble opt-?in\b|\byou'?re (?:in|subscribed)\b|\bglad you'?re here\b/.test(
      subjectLc
    )
  ) {
    return { category: "welcome", confidence: 0.92 };
  }

  if (/\bblack friday\b|\bcyber monday\b|\bchristmas\b|\bxmas\b|\bholiday sale\b|\bvalentine'?s\b|\bhalloween\b|\beaster\b|\bnew year'?s sale\b|\bsummer sale\b/.test(haystack)) {
    return { category: "seasonal", confidence: 0.9 };
  }

  // Sale rule. We split the signal in two so that loose tokens (`promo`,
  // `promotional`, `deal`, bare `sale`) that frequently appear in template
  // chrome — nav links to a /sale outlet page, "promotional newsletter" in the
  // CAN-SPAM/GDPR footer, "great deal" in stock-image alt text — don't on
  // their own classify an email as a sale. We accept the broad set of tokens
  // ONLY in the subject (where the cost of a false positive is much lower
  // because writers don't put boilerplate there), and require a stronger
  // signal in the body.
  const subjectSaleRe =
    /\bsale\b|\bdiscount\b|\b\d{1,2}%\s*off\b|\bpromo(?:tion|tional)?\b|\bdeal\b|\bcoupon\b|\bspecial offer\b/;
  const bodySaleRe =
    /\b\d{1,2}%\s*off\b|\bdiscount(?:ed)?\b|\bcoupon\b|\bspecial offer\b|\bflash sale\b|\bclearance\b|\bsale ends?\b|\bsale (?:now|starts|live|extended|continues)\b|\bsave\s+(?:up\s+to\s+)?(?:\$|€|£|kr\.?|dkk|sek|nok|eur|gbp|usd)?\s*\d+\b|\bbuy\s+\d+\s+get\s+\d+\b|\bbogo\b|\bpromo[\s-]?code\b/;
  if (subjectSaleRe.test(subjectLc) || bodySaleRe.test(haystack)) {
    return { category: "sale", confidence: 0.88 };
  }

  if (/\bintroducing\b|\bnew product\b|\bnow available\b|\bnew launch\b|\bjust launched\b|\bnewly launched\b|\bnew release\b|\bnow live\b|\bdebut\b|\bunveil(?:ing|ed)?\b|\bmeet the new\b/.test(haystack)) {
    return { category: "product_launch", confidence: 0.85 };
  }

  if (/\bthanks? for (?:signing up|subscribing|joining)\b|\bthank you for (?:signing up|subscribing|joining)\b|\bconfirm your (?:email|subscription)\b|\bdouble opt-?in\b|\byou'?re (?:in|subscribed)\b|\bgetting started\b|\bglad you'?re here\b/.test(haystack)) {
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
