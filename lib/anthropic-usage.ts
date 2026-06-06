/**
 * Anthropic API usage + cost accounting.
 *
 * Every call site that hits `/v1/messages` (classify, suggest, hq-lookup,
 * vision) hands the raw response JSON here. We pull the `usage` block the API
 * returns, price it against the snapshot below, and write one row to
 * `anthropic_usage` — fire-and-forget, so a logging failure can never break the
 * actual request. The admin dashboard reads the rollup back via
 * `pirol_admin_dashboard_stats()`.
 *
 * Cost is frozen on the row at insert time. If Anthropic changes prices, update
 * {@link MODEL_PRICING} for new calls — historical rows keep the price they
 * were charged at.
 */

import { getSupabaseAdmin } from "./supabase-admin";

/** Which call site spent the tokens. Mirrors the DB check constraint. */
export type UsageFeature = "classify" | "suggest" | "hq_lookup" | "vision";

/**
 * Token counts pulled from an Anthropic Messages response. `input_tokens` and
 * `output_tokens` exclude cached tokens — the API reports cache reads/writes
 * separately, and each is priced differently.
 */
export type AnthropicUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
};

/**
 * Per-million-token USD prices, current as of the 2026 rate card. `cacheWrite`
 * is the 5-minute-TTL write price (1.25× input); `cacheRead` is 0.1× input.
 * Web search is billed separately at {@link WEB_SEARCH_USD_PER_REQUEST}.
 */
type ModelRate = {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
};

const MODEL_PRICING: Record<string, ModelRate> = {
  haiku: { inputPerMillion: 1, outputPerMillion: 5, cacheWritePerMillion: 1.25, cacheReadPerMillion: 0.1 },
  sonnet: { inputPerMillion: 3, outputPerMillion: 15, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.3 },
  opus: { inputPerMillion: 5, outputPerMillion: 25, cacheWritePerMillion: 6.25, cacheReadPerMillion: 0.5 }
};

/** $10 per 1,000 web searches. */
const WEB_SEARCH_USD_PER_REQUEST = 0.01;

/**
 * Resolves a model id (e.g. `claude-haiku-4-5`, or an env override) to its
 * price tier by family. Falls back to Sonnet rates for an unrecognised id so we
 * never silently undercount a new model.
 */
function rateForModel(model: string): ModelRate {
  const lower = model.toLowerCase();
  if (lower.includes("haiku")) return MODEL_PRICING.haiku;
  if (lower.includes("opus")) return MODEL_PRICING.opus;
  if (lower.includes("sonnet")) return MODEL_PRICING.sonnet;
  return MODEL_PRICING.sonnet;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Pulls the usage numbers out of a raw Anthropic Messages response. Tolerant of
 * a missing `usage` block (returns all-zeros) so malformed responses still log
 * cleanly rather than throwing.
 */
export function extractAnthropicUsage(json: unknown): AnthropicUsage {
  const usage =
    json && typeof json === "object" ? (json as Record<string, unknown>).usage : undefined;
  const u = (usage && typeof usage === "object" ? usage : {}) as Record<string, unknown>;
  const serverToolUse =
    u.server_tool_use && typeof u.server_tool_use === "object"
      ? (u.server_tool_use as Record<string, unknown>)
      : {};

  return {
    inputTokens: toCount(u.input_tokens),
    outputTokens: toCount(u.output_tokens),
    cacheCreationInputTokens: toCount(u.cache_creation_input_tokens),
    cacheReadInputTokens: toCount(u.cache_read_input_tokens),
    webSearchRequests: toCount(serverToolUse.web_search_requests)
  };
}

/** USD cost of one call, priced against {@link MODEL_PRICING}. */
export function computeCostUsd(model: string, usage: AnthropicUsage): number {
  const rate = rateForModel(model);
  const cost =
    (usage.inputTokens * rate.inputPerMillion) / 1_000_000 +
    (usage.outputTokens * rate.outputPerMillion) / 1_000_000 +
    (usage.cacheCreationInputTokens * rate.cacheWritePerMillion) / 1_000_000 +
    (usage.cacheReadInputTokens * rate.cacheReadPerMillion) / 1_000_000 +
    usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  // Round to 6dp to match the numeric(12,6) column and avoid float noise.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Logs one Anthropic call's usage + cost. Fire-and-forget: callers should
 * `void` the returned promise. Never throws — any failure (no service-role key,
 * network blip, schema drift) is swallowed and warned, so cost accounting can
 * never take down the ingest pipeline.
 */
export async function recordAnthropicUsage(args: {
  feature: UsageFeature;
  model: string;
  /** Raw Anthropic response JSON, or a pre-extracted usage object. */
  usage: unknown | AnthropicUsage;
  success?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const usage = isExtractedUsage(args.usage)
      ? args.usage
      : extractAnthropicUsage(args.usage);

    // Skip writing an all-zero row (e.g. response had no usage block at all).
    const total =
      usage.inputTokens +
      usage.outputTokens +
      usage.cacheCreationInputTokens +
      usage.cacheReadInputTokens +
      usage.webSearchRequests;
    if (total === 0) {
      return;
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("anthropic_usage").insert({
      feature: args.feature,
      model: args.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: usage.cacheCreationInputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens,
      web_search_requests: usage.webSearchRequests,
      cost_usd: computeCostUsd(args.model, usage),
      success: args.success ?? true,
      metadata: (args.metadata ?? null) as never
    });
    if (error) {
      console.warn("Failed to record Anthropic usage", error.message);
    }
  } catch (error) {
    console.warn(
      "Failed to record Anthropic usage",
      error instanceof Error ? error.message : error
    );
  }
}

function isExtractedUsage(value: unknown): value is AnthropicUsage {
  return (
    !!value &&
    typeof value === "object" &&
    "inputTokens" in (value as Record<string, unknown>)
  );
}
