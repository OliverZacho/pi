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
  source: "rules" | "llm";
  model?: string;
  reasoning?: string;
  llmError?: string;
};

function getModel(): string {
  return process.env.ANTHROPIC_MODEL ?? process.env.PIROL_CLASSIFY_MODEL ?? DEFAULT_MODEL;
}

export async function classifyEmail(input: ClassifierInput): Promise<ClassificationResult> {
  const rules = classifyFromRules(input.subject, input.html);

  if (rules.confidence >= RULES_TRUST_THRESHOLD) {
    return {
      category: rules.category,
      confidence: rules.confidence,
      source: "rules"
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      category: rules.category,
      confidence: rules.confidence,
      source: "rules",
      llmError: "ANTHROPIC_API_KEY not configured"
    };
  }

  try {
    const llm = await classifyWithAnthropic(input, apiKey);
    return {
      category: llm.category,
      confidence: llm.confidence,
      source: "llm",
      model: getModel(),
      reasoning: llm.reasoning
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown llm error";
    return {
      category: rules.category,
      confidence: rules.confidence,
      source: "rules",
      llmError: message
    };
  }
}

async function classifyWithAnthropic(
  input: ClassifierInput,
  apiKey: string
): Promise<{ category: EmailCategory; confidence: number; reasoning: string }> {
  const promptText = (input.plainText ?? stripHtml(input.html)).slice(0, PROMPT_TEXT_LIMIT);

  const body = {
    model: getModel(),
    max_tokens: 256,
    temperature: 0,
    system:
      "You classify marketing emails sent by competitor brands into exactly one of these categories. " +
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
      "Always call the classify_email tool exactly once; never reply with prose. " +
      "Confidence is a number between 0 and 1 reflecting how certain you are. " +
      "Reasoning must be one or two sentences explaining the decision.",
    tools: [
      {
        name: "classify_email",
        description: "Record the classification for a marketing email.",
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
      input?: { category?: string; confidence?: number; reasoning?: string };
    }>;
  };

  const toolBlock = json.content?.find(
    (block) => block.type === "tool_use" && block.name === "classify_email"
  );

  if (!toolBlock || !toolBlock.input) {
    throw new Error("anthropic returned no tool_use block");
  }

  const candidate = toolBlock.input;

  if (!candidate.category || !CATEGORY_VALUES.includes(candidate.category as EmailCategory)) {
    throw new Error(`anthropic returned unknown category: ${candidate.category}`);
  }

  const confidence = typeof candidate.confidence === "number" ? candidate.confidence : 0.5;
  const clamped = Math.max(0, Math.min(1, confidence));

  return {
    category: candidate.category as EmailCategory,
    confidence: clamped,
    reasoning: typeof candidate.reasoning === "string" ? candidate.reasoning : ""
  };
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
