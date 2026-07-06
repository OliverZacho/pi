import { EMAIL_CATEGORIES, type EmailCategory } from "./admin-types";
import { recordAnthropicUsage } from "./anthropic-usage";
import { PLATFORM_TIMEZONE, formatDayKey } from "./datetime";
import { classifyFromRules } from "./email-utils";

const DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const RULES_TRUST_THRESHOLD = 0.85;
const PROMPT_TEXT_LIMIT = 4_000;
// The legal/postal footer (address, VAT/CVR, +country phone) is the strongest
// region signal but lives at the very bottom of the email — past the head we
// feed for categorisation. When the body is longer than the head budget we also
// append its tail so the footer is visible to the model.
const PROMPT_FOOTER_LIMIT = 1_500;
const LLM_TIMEOUT_MS = 15_000;
// Below this confidence we record the country as unknown (null) rather than
// guess. A wrong region poisons same-market comparisons; an unknown one simply
// falls back to the all-regions peer set. The harder guard against guessing is
// the "real signal" requirement in resolveDetectedCountry — this just trims the
// genuinely shaky picks.
const COUNTRY_CONFIDENCE_THRESHOLD = 0.6;
// A stated offer deadline further out than this from the send date is almost
// certainly a hallucinated or misparsed year — drop it rather than store it.
const OFFER_END_MAX_DAYS = 120;

const CATEGORY_VALUES: EmailCategory[] = [...EMAIL_CATEGORIES];

export type ClassifierInput = {
  subject: string;
  html: string;
  plainText?: string;
  /**
   * The brand's sending address or domain (e.g. `news@norr11.dk` or
   * `norr11.dk`). Used only to derive a country-code TLD hint (`.dk`,
   * `.co.uk`) that we pass to the model as a supporting region signal.
   */
  senderDomain?: string;
  /**
   * ISO timestamp of the send. Given to the model so relative deadline copy
   * ("ends Sunday", "48 hours only") can resolve to an absolute date. When
   * absent, `offerEndsOn` is never extracted — a relative deadline without an
   * anchor would be a guess.
   */
  sentAt?: string;
};

/**
 * Where a {@link ClassificationResult.detectedCountry} pick came from, kept on
 * the email so brand-level rollups and the admin UI can audit weak picks.
 */
export type CountrySignals = {
  /** ISO 639-1 language the copy is written in, when the model could tell. */
  language: string | null;
  /** Country-code TLD we derived from the sender domain, e.g. "dk", "uk". */
  tld: string | null;
  /** The dominant evidence the model leaned on for the country. */
  source: "footer_address" | "vat" | "phone" | "language" | "tld" | "mixed" | "none";
  /** Raw model country before the confidence threshold collapsed it to null. */
  rawCountry: string | null;
};

export type ClassificationResult = {
  category: EmailCategory;
  confidence: number;
  source: "rules" | "llm" | "manual";
  model?: string;
  reasoning?: string;
  llmError?: string;
  discountPercent?: number | null;
  discountAmount?: number | null;
  currency?: string | null;
  promoCode?: string | null;
  /**
   * Last calendar day (`YYYY-MM-DD`) the email states its offer is valid,
   * resolved against {@link ClassifierInput.sentAt}. Null when no deadline is
   * stated — never inferred from urgency language alone.
   */
  offerEndsOn?: string | null;
  /** True when the copy explicitly announces an extension of an earlier deadline. */
  offerIsExtension?: boolean | null;
  primaryCtaText?: string | null;
  primaryCtaUrlHint?: string | null;
  /**
   * ISO 3166-1 alpha-2 country the email is addressed to, or `null` when the
   * model wasn't confident enough (see {@link COUNTRY_CONFIDENCE_THRESHOLD}).
   */
  detectedCountry?: string | null;
  /** The model's raw country confidence (0–1), kept even when below threshold. */
  countryConfidence?: number | null;
  countrySignals?: CountrySignals | null;
};

type LlmExtraction = {
  category: EmailCategory;
  confidence: number;
  reasoning: string;
  discountPercent: number | null;
  discountAmount: number | null;
  currency: string | null;
  promoCode: string | null;
  offerEndsOn: string | null;
  offerIsExtension: boolean | null;
  primaryCtaText: string | null;
  primaryCtaUrlHint: string | null;
  country: string | null;
  language: string | null;
  countryConfidence: number;
  countrySource: CountrySignals["source"];
};

function getModel(): string {
  return process.env.ANTHROPIC_MODEL ?? process.env.PIROL_CLASSIFY_MODEL ?? DEFAULT_MODEL;
}

export async function classifyEmail(input: ClassifierInput): Promise<ClassificationResult> {
  const rules = classifyFromRules(input.subject, input.html);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      category: rules.category,
      confidence: rules.confidence,
      source: "rules",
      llmError: "ANTHROPIC_API_KEY not configured",
      discountPercent: null,
      discountAmount: null,
      currency: null,
      promoCode: null,
      offerEndsOn: null,
      offerIsExtension: null,
      primaryCtaText: null,
      primaryCtaUrlHint: null,
      detectedCountry: null,
      countryConfidence: null,
      countrySignals: null
    };
  }

  let llm: LlmExtraction | null = null;
  let llmError: string | undefined;

  try {
    llm = await classifyWithAnthropic(input, apiKey);
  } catch (error) {
    llmError = error instanceof Error ? error.message : "unknown llm error";
  }

  if (!llm) {
    return {
      category: rules.category,
      confidence: rules.confidence,
      source: "rules",
      llmError,
      discountPercent: null,
      discountAmount: null,
      currency: null,
      promoCode: null,
      offerEndsOn: null,
      offerIsExtension: null,
      primaryCtaText: null,
      primaryCtaUrlHint: null,
      detectedCountry: null,
      countryConfidence: null,
      countrySignals: null
    };
  }

  const useRulesCategory = rules.confidence >= RULES_TRUST_THRESHOLD;

  // Collapse a low-confidence / no-real-signal country to "unknown" so we never
  // benchmark a brand against the wrong region. The raw pick + confidence are
  // still kept on the signals payload for auditing and possible re-rollup.
  const tldHint = countryCodeTld(input.senderDomain);
  const detectedCountry = resolveDetectedCountry({
    rawCountry: llm.country,
    confidence: llm.countryConfidence,
    source: llm.countrySource,
    tld: tldHint
  });

  return {
    category: useRulesCategory ? rules.category : llm.category,
    confidence: useRulesCategory ? rules.confidence : llm.confidence,
    source: useRulesCategory ? "rules" : "llm",
    model: getModel(),
    reasoning: llm.reasoning,
    discountPercent: llm.discountPercent,
    discountAmount: llm.discountAmount,
    currency: llm.currency,
    promoCode: llm.promoCode,
    offerEndsOn: llm.offerEndsOn,
    offerIsExtension: llm.offerIsExtension,
    primaryCtaText: llm.primaryCtaText,
    primaryCtaUrlHint: llm.primaryCtaUrlHint,
    detectedCountry,
    countryConfidence: llm.countryConfidence,
    countrySignals: {
      language: llm.language,
      tld: tldHint,
      source: llm.countrySource,
      rawCountry: llm.country
    }
  };
}

/**
 * Decides the committed country from a model pick plus its signals, applying
 * the "unknown over wrong" guards:
 *  - confidence must clear {@link COUNTRY_CONFIDENCE_THRESHOLD}, and
 *  - a `tld` rationale is only trusted when a real country-code TLD exists.
 *
 * The second guard is narrow on purpose. The model fabricates `source: "tld"`
 * for anonymous English `.com` senders that have no country TLD at all — its
 * way of defaulting (usually to US), which is the Gisou failure mode. Every
 * other source (`footer_address`, `language`, and especially `mixed`, which is
 * what genuinely-classified brands like &Tradition / Fenty carry) is trusted:
 * those rest on the model actually reading the email, so guarding them would
 * wrongly drop correct Danish / Swedish / US brands.
 *
 * Exported so the backfill can re-apply the exact same rules to already-stored
 * `country_signals` without re-calling the model.
 */
export function resolveDetectedCountry(args: {
  rawCountry: string | null;
  confidence: number;
  source: CountrySignals["source"];
  tld: string | null;
}): string | null {
  const { rawCountry, confidence, source, tld } = args;
  if (!rawCountry) return null;
  if (confidence < COUNTRY_CONFIDENCE_THRESHOLD) return null;
  if (source === "tld" && tld === null) return null;
  return rawCountry;
}

async function classifyWithAnthropic(
  input: ClassifierInput,
  apiKey: string
): Promise<LlmExtraction> {
  const fullText = input.plainText ?? stripHtml(input.html);
  const promptText = buildPromptText(fullText);
  const tldHint = countryCodeTld(input.senderDomain);
  const sentLine = sentAtPromptLine(input.sentAt);
  // Everything the model was actually shown, for verifying verbatim quotes.
  const evidenceCorpus = `${input.subject}\n${promptText}`;

  const body = {
    model: getModel(),
    max_tokens: 512,
    temperature: 0,
    system:
      "You analyze marketing emails sent by competitor brands. " +
      "You must always call the classify_email tool exactly once; never reply with prose. " +
      "Pick the single category that best matches the email's primary purpose. " +
      "Categories: " +
      "sale: discounts, promotions, percent-off, coupons, deals targeted at existing/general subscribers. Pick this whenever a discount or deal is the headline of a regular campaign, even if specific products are shown. Do NOT pick this for first-touch onboarding emails that happen to include a signup discount — those belong to 'welcome' (see below). " +
      "product_launch: announcing a brand-new product, service, drop, or collection for the first time ('introducing', 'meet the new', 'now available', 'just launched', 'debut', 'unveiling'). " +
      "products: showcasing an existing product line or specific products without a discount headline and without launching something new. Includes 'shop the collection', new arrivals, restocks, back-in-stock, bestseller roundups, gift guides, lookbooks, category edits, and 'our latest styles' style emails. Prefer this over content/event when the email's clear intent is to drive product views/purchases. " +
      "event: invites to webinars, conferences, RSVPs, workshops, save-the-date, in-store events. Only pick this if the email is primarily about attending something. " +
      "content: editorial newsletters, blog digests, brand storytelling, interviews, behind-the-scenes, magazine-style storytelling without a clear shop-this CTA. If the email is mainly pushing products, prefer 'products'. If it primarily teaches the reader how to do something, prefer 'education'. " +
      "education: how-to guides, tutorials, recipes, owner tips, product walkthroughs, customer enablement, courses, certifications, explainers that teach a task or skill. Choose this over 'content' when the email's primary value is instructional ('how to', 'step by step', 'tips for', recipes, product academy, walkthroughs). " +
      "loyalty: rewards programs, membership tiers, re-engagement ('we miss you', 'come back', 'welcome back' to a lapsed customer), VIP perks, points redemption. " +
      "welcome: first-touch onboarding emails sent right after a user signs up or subscribes ('welcome to <brand>', 'velkommen til <brand>', 'välkommen till <brand>', 'willkommen bei <brand>', 'bienvenue chez <brand>', 'bienvenido a <brand>', 'thanks for signing up', 'thanks for subscribing', 'confirm your email', double opt-in, first-touch welcome series, getting started, 'glad you're here'). IMPORTANT: a welcome / onboarding email STAYS in this category even when it bundles a signup gift such as 'X% off your first order', a welcome coupon, or a free-shipping code — the email's primary purpose is still onboarding the new subscriber, not promoting a sale. The subject line is the strongest signal: if it greets the recipient as a newly signed-up subscriber, pick 'welcome' and surface the discount via the structured discount_percent / promo_code fields instead of changing the category. Distinct from loyalty re-engagement of lapsed customers ('welcome back'). " +
      "seasonal: holiday or seasonal campaigns (Black Friday, Cyber Monday, Christmas, Summer sale, Valentine's, Halloween). " +
      "partnership: collaborations, brand partnerships ('teaming up with', 'collab'). " +
      "company_news: rebrands, hiring announcements, milestones, funding, acquisitions, leadership changes. Monthly 'what's new' / changelog / release-recap emails that announce multiple newly shipped product features should go to 'product_launch' instead. If the email is dominated by step-by-step instructions on how to use those features, prefer 'education'. If it is a reflective narrative without specific new features, prefer 'content'. " +
      "survey: feedback requests, NPS, customer research panels, beta-tester recruitment, 'help us improve', review/rating asks. " +
      "other: marketing emails that don't fit any of the above. " +
      "Confidence is a number between 0 and 1 reflecting how certain you are about the category. " +
      "Reasoning must be one or two sentences explaining the decision. " +
      "Structured extraction (return null when not present): " +
      "discount_percent: the largest discount percentage offered (0-100), null if no percentage discount. " +
      "discount_amount: a fixed-amount discount in the email's currency, null if not a fixed amount. " +
      "currency: 3-letter ISO code (e.g. USD, EUR, GBP, DKK) when an amount or price is shown, else null. " +
      "promo_code: the literal promo/coupon code (e.g. SPRING25), null if none. " +
      "offer_ends_on: the LAST calendar day the email's offer is stated to be valid, formatted YYYY-MM-DD. Resolve relative deadline copy against the send date shown above the body: 'ends Sunday' means that week's Sunday, '48 hours only' / 'kun i 48 timer' means the send day plus 2, 'midnight tonight' / 'kun i dag' means the send day itself, 'through July 6' / 'til og med 6. juli' means that date. Only return a date the email explicitly states or that follows from an explicitly stated duration. Return null when no deadline is stated, when the urgency is vague ('for a limited time', 'while stocks last', 'ending soon'), or when no send date was provided. NEVER infer a deadline from the mere presence of a discount, the season, or the campaign theme. " +
      "offer_end_evidence: the VERBATIM phrase from the email text that states the deadline (e.g. 'Offer valid through 11:59 p.m. PT July 6' or 'kun i 48 timer'), copied character-for-character so it can be found in the text again. REQUIRED whenever offer_ends_on is not null; if you cannot point to such a phrase, offer_ends_on must be null. " +
      "offer_is_extension: true ONLY when the copy explicitly announces that an earlier deadline was extended or the sale prolonged ('extended', 'sale extended', 'forlænget', 'still on — 2 more days', 'you asked, we listened'). Use false for a normal offer without extension language, and null when the email carries no offer at all. " +
      "offer_extension_evidence: the VERBATIM phrase announcing the extension, copied character-for-character. REQUIRED whenever offer_is_extension is true; without it, answer false. " +
      "primary_cta_text: the visible label of the email's main call-to-action — the link or button the brand most wants the reader to click. This is usually a short imperative phrase ('Shop now', 'Explore Hippo Chair', 'Find resellers', 'Explore our Instagram', 'Read the story', 'Sign me up'). Pick the most prominent action link even when the email is editorial or content-focused and the link is styled as plain text rather than a button — if the email has any clear action target, return its label rather than null. Return null only when the email truly has no action link (e.g. a pure visual teaser). " +
      "primary_cta_url_hint: the destination URL (or domain) that the CTA points to when visible in the email body. Return the destination link as it appears in the body even when the brand also routes clicks through a tracking redirect; null when no destination is shown. " +
      "Region detection — determine which single country this email is primarily ADDRESSED TO (the audience), not where the brand happens to be incorporated. Weigh these signals, strongest first: " +
      "(1) the legal/postal footer — a physical address, a VAT/CVR/company-registration number, or a customer-service phone with a country calling code (+45 Denmark, +46 Sweden, +44 UK, +49 Germany, +1 US/Canada); " +
      "(2) the language the copy is written in (Danish→DK, Swedish→SE, German→DE/AT, etc.); " +
      "(3) the sender domain country-code TLD provided below as a hint. " +
      "IMPORTANT: ignore currency and any currency selector — multi-currency checkouts are i18n noise and do NOT indicate the audience's country. " +
      "country: the ISO 3166-1 alpha-2 code (uppercase, e.g. DK, SE, GB, DE, US) for the addressed market, or null if you genuinely cannot tell. Do not guess from currency alone. " +
      "CRITICAL: never default to US (or GB) just because the copy is in English. English is the global default and is NOT evidence of a US audience. If the only thing you can observe is 'English copy from a .com with no readable address', return country null with a low confidence — do NOT return US. Only name a country when a concrete positive signal supports it (a readable address/VAT/phone, a non-English language, or a real country-code TLD). " +
      "language: the ISO 639-1 code (lowercase, e.g. da, sv, de, en) of the copy, or null. " +
      "country_confidence: 0–1, how sure you are about country. Use a LOW value (<0.5) for generic English emails from a .com with no address — it is better to be unsure than wrong. " +
      "country_source: which signal actually drove the country pick — one of footer_address, vat, phone, language, tld, mixed, or none. Only answer 'tld' when a real country-code TLD is shown in the hint below; if no TLD hint is given, never claim 'tld'. Use 'none' when you are returning null.",
    tools: [
      {
        name: "classify_email",
        description: "Classify a marketing email and extract structured campaign details.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: CATEGORY_VALUES
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1
            },
            reasoning: {
              type: "string",
              minLength: 1,
              maxLength: 500
            },
            discount_percent: {
              type: ["number", "null"],
              minimum: 0,
              maximum: 100
            },
            discount_amount: {
              type: ["number", "null"],
              minimum: 0
            },
            currency: {
              type: ["string", "null"],
              minLength: 3,
              maxLength: 3
            },
            promo_code: {
              type: ["string", "null"],
              maxLength: 64
            },
            offer_ends_on: {
              type: ["string", "null"],
              maxLength: 10
            },
            offer_end_evidence: {
              type: ["string", "null"],
              maxLength: 200
            },
            offer_is_extension: {
              type: ["boolean", "null"]
            },
            offer_extension_evidence: {
              type: ["string", "null"],
              maxLength: 200
            },
            primary_cta_text: {
              type: ["string", "null"],
              maxLength: 120
            },
            primary_cta_url_hint: {
              type: ["string", "null"],
              maxLength: 500
            },
            country: {
              type: ["string", "null"],
              minLength: 2,
              maxLength: 2
            },
            language: {
              type: ["string", "null"],
              minLength: 2,
              maxLength: 3
            },
            country_confidence: {
              type: ["number", "null"],
              minimum: 0,
              maximum: 1
            },
            country_source: {
              type: ["string", "null"],
              enum: ["footer_address", "vat", "phone", "language", "tld", "mixed", "none", null]
            }
          },
          required: ["category", "confidence", "reasoning"]
        }
      }
    ],
    tool_choice: { type: "tool", name: "classify_email" },
    messages: [
      {
        role: "user",
        content:
          `Subject: ${input.subject}\n\n` +
          (sentLine ? `${sentLine}\n\n` : "") +
          (tldHint ? `Sender domain TLD hint: .${tldHint}\n\n` : "") +
          `Body:\n${promptText}`
      }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody = await safeText(response);
    throw new Error(`anthropic http ${response.status}: ${errorBody}`);
  }

  const json = (await response.json()) as {
    content?: Array<{
      type: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: unknown;
  };

  void recordAnthropicUsage({ feature: "classify", model: getModel(), usage: json });

  const toolBlock = json.content?.find(
    (block) => block.type === "tool_use" && block.name === "classify_email"
  );

  if (!toolBlock || !toolBlock.input) {
    throw new Error("anthropic returned no tool_use block");
  }

  const candidate = toolBlock.input;

  const categoryRaw = candidate.category;
  if (
    typeof categoryRaw !== "string" ||
    !CATEGORY_VALUES.includes(categoryRaw as EmailCategory)
  ) {
    throw new Error(`anthropic returned unknown category: ${String(categoryRaw)}`);
  }

  const confidenceRaw = candidate.confidence;
  const confidence = typeof confidenceRaw === "number" ? confidenceRaw : 0.5;
  const clampedConfidence = Math.max(0, Math.min(1, confidence));

  return {
    category: categoryRaw as EmailCategory,
    confidence: clampedConfidence,
    reasoning: typeof candidate.reasoning === "string" ? candidate.reasoning : "",
    discountPercent: clampNumberInRange(candidate.discount_percent, 0, 100),
    discountAmount: clampNumberInRange(candidate.discount_amount, 0, 1_000_000),
    currency: normalizeCurrency(candidate.currency),
    promoCode: normalizeShortString(candidate.promo_code, 64),
    offerEndsOn: quoteAppearsIn(candidate.offer_end_evidence, evidenceCorpus)
      ? normalizeOfferEndsOn(candidate.offer_ends_on, input.sentAt)
      : null,
    offerIsExtension: normalizeOfferIsExtension(
      candidate.offer_is_extension,
      candidate.offer_extension_evidence,
      evidenceCorpus
    ),
    primaryCtaText: normalizeShortString(candidate.primary_cta_text, 120),
    primaryCtaUrlHint: normalizeShortString(candidate.primary_cta_url_hint, 500),
    country: normalizeCountryCode(candidate.country),
    language: normalizeLanguageCode(candidate.language),
    countryConfidence: clampNumberInRange(candidate.country_confidence, 0, 1) ?? 0,
    countrySource: normalizeCountrySource(candidate.country_source)
  };
}

function clampNumberInRange(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.max(min, Math.min(max, n));
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeShortString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLen);
}

/**
 * The send-date line fed to the model so relative deadlines resolve. Includes
 * the weekday (platform zone) because "ends Sunday" is unresolvable without
 * knowing which day the email landed on.
 */
function sentAtPromptLine(sentAt: string | undefined): string | null {
  if (!sentAt) return null;
  const instant = new Date(sentAt);
  if (!Number.isFinite(instant.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: PLATFORM_TIMEZONE
  }).format(instant);
  return `Sent: ${weekday} ${formatDayKey(instant, PLATFORM_TIMEZONE)}`;
}

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Noon-UTC epoch for a day key; NaN when the key names an impossible date. */
function dayKeyToUtcNoon(dayKey: string): number {
  const match = DAY_KEY_RE.exec(dayKey);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day, 12);
  const roundTrip = new Date(ms);
  // Reject overflow dates (2026-02-30 silently becomes March 2 otherwise).
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() + 1 !== month ||
    roundTrip.getUTCDate() !== day
  ) {
    return NaN;
  }
  return ms;
}

/**
 * Whether a model-returned "verbatim" quote really occurs in the text the
 * model was shown, after collapsing whitespace and case. This is the guard
 * against invented deadlines: the model must point at the phrase that states
 * the claim, and a fabricated phrase won't be found. Quotes shorter than a
 * few characters are rejected — they'd match almost anything.
 */
function quoteAppearsIn(quote: unknown, corpus: string): boolean {
  if (typeof quote !== "string") return false;
  const normalize = (text: string) =>
    text.toLowerCase().replace(/\s+/g, " ").trim();
  const needle = normalize(quote);
  if (needle.length < 4) return false;
  return normalize(corpus).includes(needle);
}

/**
 * An extension claim is only trusted with a verifiable quote; an unsupported
 * `true` collapses to `false` (i.e. "offer, but no extension language") so a
 * hallucinated extension can never paint the dashed segment.
 */
function normalizeOfferIsExtension(
  value: unknown,
  evidence: unknown,
  corpus: string
): boolean | null {
  if (typeof value !== "boolean") return null;
  if (value && !quoteAppearsIn(evidence, corpus)) return false;
  return value;
}

/**
 * Accepts a model-returned offer end date only when it is a real calendar
 * day anchored by a known send date, is not in the send date's past, and sits
 * within {@link OFFER_END_MAX_DAYS}. Everything else is stored as "no stated
 * deadline" — a wrong window is worse than none. (The verbatim-evidence gate
 * in the caller runs on top of this.)
 */
function normalizeOfferEndsOn(
  value: unknown,
  sentAt: string | undefined
): string | null {
  if (typeof value !== "string" || !sentAt) return null;
  const trimmed = value.trim();
  const endMs = dayKeyToUtcNoon(trimmed);
  if (!Number.isFinite(endMs)) return null;
  const sentInstant = new Date(sentAt);
  if (!Number.isFinite(sentInstant.getTime())) return null;
  const sentDayMs = dayKeyToUtcNoon(formatDayKey(sentInstant, PLATFORM_TIMEZONE));
  const diffDays = Math.round((endMs - sentDayMs) / 86_400_000);
  if (diffDays < 0 || diffDays > OFFER_END_MAX_DAYS) return null;
  return trimmed;
}

function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(trimmed) ? trimmed : null;
}

const COUNTRY_SOURCES: ReadonlySet<CountrySignals["source"]> = new Set([
  "footer_address",
  "vat",
  "phone",
  "language",
  "tld",
  "mixed",
  "none"
]);

function normalizeCountrySource(value: unknown): CountrySignals["source"] {
  if (typeof value === "string" && COUNTRY_SOURCES.has(value as CountrySignals["source"])) {
    return value as CountrySignals["source"];
  }
  return "none";
}

/**
 * Pulls the country-code TLD from a sender address/domain so we can hand the
 * model a deterministic supporting hint. Returns the ccTLD lower-cased (e.g.
 * "dk", "uk", "de") or `null` for generic TLDs (`.com`, `.net`) and anything we
 * can't parse — those carry no country signal. Handles `news@brand.co.uk` and
 * bare `brand.dk` alike, and unwraps two-level public suffixes like `.co.uk`.
 */
export function countryCodeTld(senderDomain: string | undefined): string | null {
  if (!senderDomain) {
    return null;
  }
  const afterAt = senderDomain.includes("@")
    ? senderDomain.slice(senderDomain.lastIndexOf("@") + 1)
    : senderDomain;
  const host = afterAt.trim().toLowerCase().replace(/[.>\s]+$/, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) {
    return null;
  }
  const last = labels[labels.length - 1];
  // Two-level suffixes (co.uk, com.au): the ccTLD is the final label.
  if (!/^[a-z]{2}$/.test(last)) {
    return null;
  }
  // Generic two-letter TLDs that aren't really country audiences in practice.
  if (last === "io" || last === "co" || last === "ai" || last === "tv") {
    return null;
  }
  return last;
}

function buildPromptText(fullText: string): string {
  if (fullText.length <= PROMPT_TEXT_LIMIT) {
    return fullText;
  }
  const head = fullText.slice(0, PROMPT_TEXT_LIMIT);
  const tail = fullText.slice(-PROMPT_FOOTER_LIMIT);
  // Don't duplicate text when head and tail would overlap.
  if (fullText.length <= PROMPT_TEXT_LIMIT + PROMPT_FOOTER_LIMIT) {
    return fullText.slice(0, PROMPT_TEXT_LIMIT + PROMPT_FOOTER_LIMIT);
  }
  return `${head}\n\n[…trimmed…]\n\nEmail footer:\n${tail}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}
