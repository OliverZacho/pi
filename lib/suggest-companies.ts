const DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const LLM_TIMEOUT_MS = 60_000;
const MAX_EXCLUDE_DOMAINS = 200;
const MAX_RESULTS = 30;
const MIN_RESULTS = 1;
const DEFAULT_RESULTS = 10;
const WEB_SEARCH_TOOL_VERSION = "web_search_20250305";
const DEFAULT_WEB_SEARCH_USES = 5;
const DEFAULT_VERIFY_TIMEOUT_MS = 4_000;

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

function webSearchEnabled(): boolean {
  const raw = process.env.PIROL_SUGGEST_WEB_SEARCH;
  if (!raw) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

function maxWebSearchUses(): number {
  const raw = process.env.PIROL_SUGGEST_MAX_SEARCHES;
  if (!raw) {
    return DEFAULT_WEB_SEARCH_USES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WEB_SEARCH_USES;
  }
  return Math.min(20, parsed);
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
  const useWebSearch = webSearchEnabled();

  const tools: Array<Record<string, unknown>> = [
    {
      name: "suggest_companies",
      description:
        "Return the final list of brand suggestions for the market after you have verified them via web search.",
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
  ];

  if (useWebSearch) {
    tools.unshift({
      type: WEB_SEARCH_TOOL_VERSION,
      name: "web_search",
      max_uses: maxWebSearchUses()
    });
  }

  const systemBase =
    "You are a brand research assistant for Pirol, a competitor newsletter intelligence tool. " +
    "Your job is to surface REAL, currently-operating brands that send marketing newsletters and are worth tracking. " +
    "Hard rules: " +
    "1) Never invent, guess, or hallucinate brand names or domains. If you are not sure a brand or domain exists, drop it. " +
    "2) Every candidate must be a brand whose primary domain you have seen in actual web search results in this turn. " +
    "3) The 'domain' field must be the brand's primary registrable domain exactly as it appears on the live web (no protocol, no path, no 'www.'). " +
    "4) Never repeat any domain in the exclude list (case-insensitive). " +
    "5) 'why_relevant' is one short sentence (<=180 chars) explaining why this brand is a good fit for the market, grounded in the search result. " +
    "6) 'country' is an ISO 3166-1 alpha-2 country code uppercased, or null if you genuinely don't know. " +
    "7) Diversity matters: avoid suggesting many sub-brands of the same parent company. " +
    "8) End your turn by calling the suggest_companies tool exactly once with the verified list. Never reply with prose only.";

  const systemWithSearch =
    systemBase +
    " Process: " +
    "(a) Call web_search with focused queries (e.g. 'best <market> brands newsletter', 'top <market> DTC brands site:<region tld>') 1-5 times until you have enough real brands. " +
    "(b) Confirm each brand's primary domain from the search results before including it. " +
    "(c) Then call suggest_companies. Prefer dropping a candidate over guessing its domain.";

  const systemWithoutSearch =
    systemBase +
    " You do not have web search available, so be conservative: only return brands and domains you are highly confident exist. Prefer returning fewer candidates over guessing.";

  const body = {
    model,
    max_tokens: 4096,
    temperature: 0.3,
    system: useWebSearch ? systemWithSearch : systemWithoutSearch,
    tools,
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content:
          `Market: ${market}\n` +
          `Target count: ${desired}\n` +
          `Exclude these domains (already tracked or already dismissed):\n${excludeBlock}\n\n` +
          (useWebSearch
            ? "Use web search to find real, currently-operating brands in this market. " +
              "Only include brands whose primary domain you can see directly in a search result. " +
              "Then call suggest_companies with the verified list."
            : "Only include brands you are highly confident exist. Then call suggest_companies.")
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
    stop_reason?: string;
  };

  const toolBlock = json.content?.find(
    (block) =>
      block.type === "tool_use" &&
      block.name === "suggest_companies" &&
      block.input &&
      Array.isArray(block.input.candidates)
  );

  if (!toolBlock || !toolBlock.input || !Array.isArray(toolBlock.input.candidates)) {
    throw new SuggestCompaniesError(
      "llm_format",
      `anthropic did not call suggest_companies (stop_reason=${json.stop_reason ?? "unknown"})`
    );
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

export type DomainVerification = {
  domain: string;
  ok: boolean;
  status: number | null;
  reason: string | null;
};

export type VerifyDomainsOptions = {
  timeoutMs?: number;
  concurrency?: number;
};

export type VerifyDomainsResult = {
  verifications: DomainVerification[];
  kept: string[];
  dropped: string[];
};

const PROBE_USER_AGENT =
  "PirolDomainVerifier/1.0 (+https://pirol.app; checking newsletter signups)";

export async function verifyDomains(
  domains: string[],
  options: VerifyDomainsOptions = {}
): Promise<VerifyDomainsResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const concurrency = Math.max(1, Math.min(16, options.concurrency ?? 8));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of domains) {
    const normalized = normalizeDomain(raw);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  const verifications: DomainVerification[] = new Array(unique.length);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= unique.length) {
        return;
      }
      const domain = unique[index];
      verifications[index] = await probeDomain(domain, timeoutMs);
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, unique.length);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const verification of verifications) {
    if (verification.ok) {
      kept.push(verification.domain);
    } else {
      dropped.push(verification.domain);
    }
  }

  return { verifications, kept, dropped };
}

async function probeDomain(
  domain: string,
  timeoutMs: number
): Promise<DomainVerification> {
  const attempts: Array<{ url: string; method: "HEAD" | "GET" }> = [
    { url: `https://${domain}/`, method: "HEAD" },
    { url: `https://${domain}/`, method: "GET" },
    { url: `https://www.${domain}/`, method: "GET" },
    { url: `http://${domain}/`, method: "GET" }
  ];

  let lastReason: string | null = null;
  let lastStatus: number | null = null;

  for (const attempt of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(attempt.url, {
        method: attempt.method,
        redirect: "follow",
        headers: { "user-agent": PROBE_USER_AGENT, accept: "*/*" },
        signal: controller.signal
      });
      lastStatus = response.status;
      try {
        await response.body?.cancel();
      } catch {
        // ignore body cancel errors
      }
      if (response.status >= 200 && response.status < 500) {
        return { domain, ok: true, status: response.status, reason: null };
      }
      lastReason = `http_${response.status}`;
    } catch (error) {
      if (controller.signal.aborted) {
        lastReason = "timeout";
      } else if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes("enotfound") || message.includes("getaddrinfo")) {
          lastReason = "dns_not_found";
          break;
        }
        lastReason = message.slice(0, 80);
      } else {
        lastReason = "unknown_error";
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return { domain, ok: false, status: lastStatus, reason: lastReason ?? "unreachable" };
}
