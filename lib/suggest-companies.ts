const DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const LLM_TIMEOUT_MS = 20_000;
const MAX_EXCLUDE_DOMAINS = 200;
const MAX_RESULTS = 30;
const MIN_RESULTS = 1;
const DEFAULT_RESULTS = 10;

export type SuggestionCandidate = {
  name: string;
  domain: string;
  country: string | null;
  whyRelevant: string;
};

export type SuggestCompaniesInput = {
  market: string;
  count?: number;
  excludeDomains?: string[];
  signal?: AbortSignal;
};

export type SuggestCompaniesResult = {
  candidates: SuggestionCandidate[];
  model: string;
};

type LlmCandidate = {
  name: unknown;
  domain: unknown;
  country?: unknown;
  why_relevant?: unknown;
};

export class SuggestCompaniesError extends Error {
  readonly code: "missing_api_key" | "llm_http" | "llm_format" | "llm_timeout" | "llm_unknown";

  constructor(code: SuggestCompaniesError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "SuggestCompaniesError";
  }
}

function getModel(): string {
  return (
    process.env.ANTHROPIC_SUGGEST_MODEL ??
    process.env.ANTHROPIC_MODEL ??
    process.env.PIROL_CLASSIFY_MODEL ??
    DEFAULT_MODEL
  );
}

export async function suggestCompanies(
  input: SuggestCompaniesInput
): Promise<SuggestCompaniesResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new SuggestCompaniesError(
      "missing_api_key",
      "ANTHROPIC_API_KEY not configured"
    );
  }

  const market = input.market.trim();
  if (!market) {
    throw new SuggestCompaniesError("llm_format", "market is required");
  }

  const desired = clampCount(input.count);
  const excludeList = normalizeExcludeList(input.excludeDomains);
  const excludeBlock =
    excludeList.length === 0
      ? "(none)"
      : excludeList.map((domain) => `- ${domain}`).join("\n");

  const model = getModel();

  const body = {
    model,
    max_tokens: 1024,
    temperature: 0.5,
    system:
      "You are a brand research assistant for Pirol, a competitor newsletter intelligence tool. " +
      "Given a market (a free-text vertical such as 'scandinavian fashion', 'museum', 'specialty coffee'), " +
      "you propose other real, currently-operating brands that send marketing newsletters and are worth tracking. " +
      "Always call the suggest_companies tool exactly once; never reply with prose. " +
      "Hard rules: " +
      "1) Each candidate must be a real, currently-active brand with a working public website at the provided domain. " +
      "2) Never repeat any domain in the exclude list (case-insensitive). " +
      "3) The 'domain' field is the bare registrable domain (e.g. 'ganni.com'), no protocol, no path, no www. " +
      "4) Prefer brands that are well-known to actually send marketing newsletters (DTC, retail, media, museums). " +
      "5) 'why_relevant' is one short sentence (<=180 chars) explaining why this brand is a good fit for the market. " +
      "6) 'country' is an ISO 3166-1 alpha-2 country code uppercased, or null if you genuinely don't know. " +
      "7) Diversity matters: avoid suggesting many sub-brands of the same parent company.",
    tools: [
      {
        name: "suggest_companies",
        description:
          "Return a list of brand suggestions for a market that should be onboarded into Pirol.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidates: {
              type: "array",
              minItems: 1,
              maxItems: MAX_RESULTS,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 120 },
                  domain: { type: "string", minLength: 3, maxLength: 253 },
                  country: { type: ["string", "null"], minLength: 2, maxLength: 2 },
                  why_relevant: { type: "string", minLength: 1, maxLength: 200 }
                },
                required: ["name", "domain", "why_relevant"]
              }
            }
          },
          required: ["candidates"]
        }
      }
    ],
    tool_choice: { type: "tool", name: "suggest_companies" },
    messages: [
      {
        role: "user",
        content:
          `Market: ${market}\n` +
          `Target count: ${desired}\n` +
          `Exclude these domains (already tracked or already dismissed):\n${excludeBlock}`
      }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const externalAbort = () => controller.abort();
  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort();
    } else {
      input.signal.addEventListener("abort", externalAbort, { once: true });
    }
  }

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
    if (controller.signal.aborted) {
      throw new SuggestCompaniesError("llm_timeout", "anthropic request aborted");
    }
    const message = error instanceof Error ? error.message : "anthropic request failed";
    throw new SuggestCompaniesError("llm_unknown", message);
  } finally {
    clearTimeout(timer);
    if (input.signal) {
      input.signal.removeEventListener("abort", externalAbort);
    }
  }

  if (!response.ok) {
    const text = await safeText(response);
    throw new SuggestCompaniesError(
      "llm_http",
      `anthropic http ${response.status}: ${text}`
    );
  }

  const json = (await response.json()) as {
    content?: Array<{
      type: string;
      name?: string;
      input?: { candidates?: LlmCandidate[] };
    }>;
  };

  const toolBlock = json.content?.find(
    (block) => block.type === "tool_use" && block.name === "suggest_companies"
  );

  if (!toolBlock || !toolBlock.input || !Array.isArray(toolBlock.input.candidates)) {
    throw new SuggestCompaniesError("llm_format", "anthropic returned no tool_use block");
  }

  const excludeSet = new Set(excludeList);
  const seen = new Set<string>();
  const candidates: SuggestionCandidate[] = [];

  for (const raw of toolBlock.input.candidates) {
    const candidate = normalizeCandidate(raw);
    if (!candidate) {
      continue;
    }
    if (excludeSet.has(candidate.domain)) {
      continue;
    }
    if (seen.has(candidate.domain)) {
      continue;
    }
    seen.add(candidate.domain);
    candidates.push(candidate);
    if (candidates.length >= desired) {
      break;
    }
  }

  return { candidates, model };
}

function clampCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RESULTS;
  }
  const rounded = Math.floor(value);
  return Math.max(MIN_RESULTS, Math.min(MAX_RESULTS, rounded));
}

function normalizeExcludeList(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  const set = new Set<string>();
  for (const raw of values) {
    const normalized = normalizeDomain(raw);
    if (normalized) {
      set.add(normalized);
    }
    if (set.size >= MAX_EXCLUDE_DOMAINS) {
      break;
    }
  }
  return Array.from(set);
}

function normalizeCandidate(raw: LlmCandidate): SuggestionCandidate | null {
  if (typeof raw.name !== "string" || typeof raw.domain !== "string") {
    return null;
  }
  const name = raw.name.trim();
  const domain = normalizeDomain(raw.domain);
  if (!name || !domain) {
    return null;
  }
  const country = normalizeCountry(raw.country);
  const whyRelevant =
    typeof raw.why_relevant === "string" ? raw.why_relevant.trim().slice(0, 200) : "";
  return {
    name: name.slice(0, 120),
    domain,
    country,
    whyRelevant
  };
}

export function normalizeDomain(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  let domain = value.trim().toLowerCase();
  if (!domain) {
    return "";
  }
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.split("/")[0] ?? "";
  domain = domain.split("?")[0] ?? "";
  domain = domain.replace(/^www\./, "");
  domain = domain.replace(/[^a-z0-9.\-]/g, "");
  if (!domain.includes(".") || domain.length < 3 || domain.length > 253) {
    return "";
  }
  return domain;
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}
