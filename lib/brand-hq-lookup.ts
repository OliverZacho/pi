/**
 * Brand-level headquarters / "global brand" resolver.
 *
 * Per-email text classification (see `classify.ts`) can't see an address that
 * lives in a footer *image*, and it has no way to know whether an English-only
 * brand is genuinely global or just a national brand writing in English. This
 * module fills that gap with a single Sonnet call per brand that may use web
 * search: given the brand name + domain it returns the HQ country (ISO 3166-1
 * alpha-2) or flags the brand as `global`.
 *
 * It is deliberately a *brand-level* fallback (≈once per brand), not a per-email
 * pass, so the volume — and cost — is tiny. The caller decides when to use it;
 * the intended policy is: trust a non-English email signal first (a localized
 * list is country-specific), and only reach for this when the email signal is
 * English/ambiguous/unknown.
 */

const DEFAULT_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const LOOKUP_TIMEOUT_MS = 60_000;
const MAX_WEB_SEARCHES = 3;

function getModel(): string {
  return process.env.PIROL_HQ_MODEL ?? DEFAULT_MODEL;
}

export type BrandOriginSource = { title: string | null; url: string };

export type BrandOriginResult = {
  /** ISO 3166-1 alpha-2 HQ country, or null when global / unknown. */
  country: string | null;
  /** True when the brand has no single home market (H&M, Coca-Cola, Nike…). */
  isGlobal: boolean;
  confidence: number;
  reasoning: string;
  /** Web pages the model cited, for auditing. Empty when it answered from memory. */
  sources: BrandOriginSource[];
  model: string;
  error?: string;
};

type BrandOriginInput = {
  name: string;
  domain: string | null;
};

const SYSTEM_PROMPT =
  "You identify where a consumer/retail brand is based, so brands can be grouped " +
  "by home market and send-time timezone for a marketing-analytics tool. " +
  "Given a brand name and its website domain, determine the country of the brand's " +
  "headquarters as an ISO 3166-1 alpha-2 code (e.g. DK, SE, NL, US, GB, DE). " +
  "Use the web_search tool whenever you are not highly confident from your own " +
  "knowledge — small or regional brands especially. Prefer the brand's own about/contact " +
  "page or a reliable encyclopedia. " +
  "ALWAYS return the HQ country (ISO alpha-2) when you can determine it, regardless of the " +
  "global flag. " +
  "GLOBAL — be VERY conservative. Set is_global=true ONLY for a small set of household-name " +
  "multinational giants whose consumer identity has no home country in customers' minds — " +
  "think H&M, Zara, Coca-Cola, Nike, IKEA, Adidas, McDonald's, Apple, Uniqlo, Sephora. " +
  "Selling in many countries, shipping worldwide, or having international distribution does " +
  "NOT make a brand global: a Danish furniture brand sold in 65 countries is still Danish " +
  "(DK, is_global=false); a Swedish-owned fashion label is Swedish (SE); a US celebrity " +
  "beauty brand is US. When unsure, choose the HQ country with is_global=false. " +
  "If you genuinely cannot determine the brand's base, return country=null, is_global=false, " +
  "and a low confidence rather than guessing. " +
  "When finished, call report_brand_origin exactly once.";

/**
 * Resolves a brand's HQ country / global status via Sonnet (+ web search).
 * Never throws: failures come back on the `error` field with a null country so
 * the caller can skip the brand and move on.
 */
export async function lookupBrandOrigin(
  input: BrandOriginInput
): Promise<BrandOriginResult> {
  const model = getModel();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const empty: BrandOriginResult = {
    country: null,
    isGlobal: false,
    confidence: 0,
    reasoning: "",
    sources: [],
    model
  };

  if (!apiKey) {
    return { ...empty, error: "ANTHROPIC_API_KEY not configured" };
  }

  const body = {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES },
      {
        name: "report_brand_origin",
        description: "Report the brand's headquarters country and whether it is a truly global brand.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            country: {
              type: ["string", "null"],
              minLength: 2,
              maxLength: 2,
              description: "ISO 3166-1 alpha-2 HQ country, or null if unknown."
            },
            is_global: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reasoning: { type: "string", minLength: 1, maxLength: 600 }
          },
          required: ["country", "is_global", "confidence", "reasoning"]
        }
      }
    ],
    messages: [
      {
        role: "user",
        content:
          `Brand: ${input.name}\n` +
          (input.domain ? `Website: ${input.domain}\n` : "") +
          `\nWhere is this brand headquartered, and is it a truly global brand?`
      }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

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
  } catch (error) {
    clearTimeout(timer);
    return { ...empty, error: error instanceof Error ? error.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await safeText(response);
    return { ...empty, error: `anthropic http ${response.status}: ${text}` };
  }

  const json = (await response.json()) as { content?: ContentBlock[] };
  const blocks = json.content ?? [];

  const report = blocks.find(
    (b) => b.type === "tool_use" && b.name === "report_brand_origin"
  );
  if (!report || !report.input) {
    return { ...empty, error: "model did not call report_brand_origin" };
  }

  const candidate = report.input;
  return {
    country: normalizeCountry(candidate.country),
    isGlobal: candidate.is_global === true,
    confidence: clamp01(typeof candidate.confidence === "number" ? candidate.confidence : 0.5),
    reasoning: typeof candidate.reasoning === "string" ? candidate.reasoning : "",
    sources: extractSources(blocks),
    model
  };
}

type ContentBlock = {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type?: string; title?: string; url?: string }>;
};

function extractSources(blocks: ContentBlock[]): BrandOriginSource[] {
  const sources: BrandOriginSource[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) {
      continue;
    }
    for (const item of block.content) {
      if (item?.type === "web_search_result" && typeof item.url === "string") {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        sources.push({ title: typeof item.title === "string" ? item.title : null, url: item.url });
      }
    }
  }
  return sources;
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
