import type { EmailCategory } from "./admin-types";
import { classifyFromRules } from "./email-utils";

const DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const RULES_TRUST_THRESHOLD = 0.85;
const PROMPT_TEXT_LIMIT = 4_000;
const LLM_TIMEOUT_MS = 15_000;

const CATEGORY_VALUES: EmailCategory[] = [
  "sale",
  "product_launch",
  "event",
  "content",
  "loyalty",
  "transactional",
  "seasonal",
  "partnership",
  "company_news",
  "other"
];

export type ClassifierInput = {
  subject: string;
  html: string;
  plainText?: string;
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
  primaryCtaText?: string | null;
  primaryCtaUrlHint?: string | null;
};

type LlmExtraction = {
  category: EmailCategory;
  confidence: number;
  reasoning: string;
  discountPercent: number | null;
  discountAmount: number | null;
  currency: string | null;
  promoCode: string | null;
  primaryCtaText: string | null;
  primaryCtaUrlHint: string | null;
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
      primaryCtaText: null,
      primaryCtaUrlHint: null
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
      primaryCtaText: null,
      primaryCtaUrlHint: null
    };
  }

  const useRulesCategory = rules.confidence >= RULES_TRUST_THRESHOLD;

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
    primaryCtaText: llm.primaryCtaText,
    primaryCtaUrlHint: llm.primaryCtaUrlHint
  };
}

async function classifyWithAnthropic(
  input: ClassifierInput,
  apiKey: string
): Promise<LlmExtraction> {
  const promptText = (input.plainText ?? stripHtml(input.html)).slice(0, PROMPT_TEXT_LIMIT);

  const body = {
    model: getModel(),
    max_tokens: 512,
    temperature: 0,
    system:
      "You analyze marketing emails sent by competitor brands. " +
      "You must always call the classify_email tool exactly once; never reply with prose. " +
      "Categories: " +
      "sale: discounts, promotions, percent-off, coupons, deals. " +
      "product_launch: announcing a new product or service ('introducing', 'now available', 'just launched'). " +
      "event: invites to webinars, conferences, RSVPs, workshops, save-the-date. " +
      "content: editorial newsletters, blog digests, brand storytelling without a clear purchase CTA. " +
      "loyalty: rewards programs, membership, re-engagement ('we miss you', 'come back'), VIP perks. " +
      "transactional: receipts, order confirmations, shipping updates, invoices (rare in this dataset). " +
      "seasonal: holiday or seasonal campaigns (Black Friday, Cyber Monday, Christmas, Summer sale). " +
      "partnership: collaborations, brand partnerships ('teaming up with', 'collab'). " +
      "company_news: rebrands, hiring announcements, milestones, funding, acquisitions. " +
      "other: marketing emails that don't fit any of the above. " +
      "Confidence is a number between 0 and 1 reflecting how certain you are about the category. " +
      "Reasoning must be one or two sentences explaining the decision. " +
      "Structured extraction (return null when not present): " +
      "discount_percent: the largest discount percentage offered (0-100), null if no percentage discount. " +
      "discount_amount: a fixed-amount discount in the email's currency, null if not a fixed amount. " +
      "currency: 3-letter ISO code (e.g. USD, EUR, GBP, DKK) when an amount or price is shown, else null. " +
      "promo_code: the literal promo/coupon code (e.g. SPRING25), null if none. " +
      "primary_cta_text: the visible label of the most prominent call-to-action button. " +
      "primary_cta_url_hint: the URL or domain of that CTA when known, else null.",
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
            primary_cta_text: {
              type: ["string", "null"],
              maxLength: 120
            },
            primary_cta_url_hint: {
              type: ["string", "null"],
              maxLength: 500
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
        content: `Subject: ${input.subject}\n\nBody:\n${promptText}`
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
  };

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
    primaryCtaText: normalizeShortString(candidate.primary_cta_text, 120),
    primaryCtaUrlHint: normalizeShortString(candidate.primary_cta_url_hint, 500)
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
