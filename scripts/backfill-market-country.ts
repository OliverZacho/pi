/**
 * Backfills per-email detected country + brand-level primary market for rows
 * captured before region detection existed.
 *
 * Phase 1 re-runs the classifier on each email purely to extract its country
 * signals (footer address / VAT, copy language, sender ccTLD) and writes ONLY
 * the country columns — category, discount, CTA etc. are left untouched.
 * Phase 2 rolls those per-email picks up into companies.primary_market_country.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-market-country.ts
 *
 * Flags:
 *   --dry-run         Don't write anything, just print what would change.
 *   --force           Re-detect rows we've already attempted (country_signals
 *                     is not null). Off by default so reruns only fill gaps.
 *   --thin            Re-classify only already-attempted rows with English copy
 *                     and no real country TLD — the "could be a US-default guess"
 *                     set. Re-reads them against the current prompt; reliable
 *                     non-English / real-ccTLD / footer picks are left alone.
 *   --company=<id>    Only process rows belonging to <id>. Repeatable.
 *   --limit=<n>       Process at most <n> rows. Useful for spot-checks.
 *   --concurrency=<n> Max parallel LLM calls. Defaults to 2.
 *   --min-interval=<ms> Min spacing between classifier calls (default 4500) to
 *                     stay under the org's per-minute token limit. 0 disables.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyEmail } from "../lib/classify";
import { recomputeCompanyMarket } from "../lib/market-detect";
import type { Database, Json } from "../types/supabase";

type Row = {
  id: string;
  subject: string;
  html_content: string;
  plain_text: string | null;
  sender_email: string;
  company_id: string | null;
  detected_country: string | null;
  country_signals: Json | null;
};

type CliOptions = {
  dryRun: boolean;
  force: boolean;
  /**
   * Re-classify only "thin signal" rows: already-attempted emails whose pick
   * rested on English copy with no real country TLD — the set where the model
   * could have been guessing (e.g. defaulting to US). Re-reads them against the
   * improved prompt; reliable non-English / real-ccTLD picks are left alone.
   */
  thin: boolean;
  onlyCompanies: Set<string> | null;
  limit: number | null;
  concurrency: number;
  minIntervalMs: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    force: false,
    thin: false,
    onlyCompanies: null,
    limit: null,
    concurrency: 2,
    // The org's Haiku limit (50k input tokens/min) binds before the 50 req/min
    // one: at ~3.5k tokens per call that's ~14 calls/min, so we space request
    // starts ~4.5s apart by default. Override with --min-interval=<ms>.
    minIntervalMs: 4500
  };

  for (const raw of argv) {
    if (raw === "--dry-run") {
      opts.dryRun = true;
    } else if (raw === "--force") {
      opts.force = true;
    } else if (raw === "--thin") {
      opts.thin = true;
    } else if (raw.startsWith("--min-interval=")) {
      const value = Number.parseInt(raw.slice("--min-interval=".length), 10);
      if (Number.isFinite(value) && value >= 0) {
        opts.minIntervalMs = value;
      }
    } else if (raw.startsWith("--company=")) {
      const value = raw.slice("--company=".length).trim();
      if (value) {
        if (!opts.onlyCompanies) {
          opts.onlyCompanies = new Set();
        }
        opts.onlyCompanies.add(value);
      }
    } else if (raw.startsWith("--limit=")) {
      const value = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        opts.limit = value;
      }
    } else if (raw.startsWith("--concurrency=")) {
      const value = Number.parseInt(raw.slice("--concurrency=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        opts.concurrency = value;
      }
    }
  }

  return opts;
}

function loadDotEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function buildAdminClient(): SupabaseClient<Database> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Global request pacer: spaces classifier calls at least `minIntervalMs` apart
 * regardless of concurrency, so the bulk backfill stays under the org's
 * per-minute token limit. (Live ingest classifies one email at a time, so this
 * only matters here, which is why the throttle lives in the script.)
 */
let nextSlotAt = 0;
async function acquireSlot(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + minIntervalMs;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

const MAX_429_RETRIES = 6;

function isRateLimit(error: string | undefined): boolean {
  return !!error && /429|rate_limit/i.test(error);
}

type ProcessResult =
  | { kind: "detected"; id: string; country: string; confidence: number }
  | { kind: "unknown"; id: string }
  | { kind: "errored"; id: string; error: string }
  | { kind: "failed"; id: string; error: string };

async function processRow(
  supabase: SupabaseClient<Database>,
  row: Row,
  opts: CliOptions
): Promise<ProcessResult> {
  let result;
  // Retry rate-limit responses with exponential backoff. The classifier
  // swallows the 429 into result.llmError rather than throwing, so we inspect
  // that and re-issue after backing off; the pacer keeps the steady-state rate
  // sustainable, this just absorbs bursts.
  for (let attempt = 0; ; attempt += 1) {
    await acquireSlot(opts.minIntervalMs);
    try {
      result = await classifyEmail({
        subject: row.subject,
        html: row.html_content,
        plainText: row.plain_text ?? undefined,
        senderDomain: row.sender_email
      });
    } catch (error) {
      return {
        kind: "failed",
        id: row.id,
        error: error instanceof Error ? error.message : "unknown error"
      };
    }

    if (isRateLimit(result.llmError) && attempt < MAX_429_RETRIES) {
      await sleep(Math.min(60_000, 4_000 * 2 ** attempt) + Math.random() * 1_000);
      continue;
    }
    break;
  }

  // The classifier swallows LLM failures (rate limit, timeout, missing key) and
  // returns a rules-only result with a null country — indistinguishable from a
  // genuine "unknown" except that llmError is set. Treat those as retryable and
  // do NOT write: leaving country_signals null keeps the row eligible for a
  // plain rerun, instead of locking in a fake "unknown".
  if (result.llmError) {
    return { kind: "errored", id: row.id, error: result.llmError };
  }

  if (!opts.dryRun) {
    const { error } = await supabase
      .from("captured_emails")
      .update({
        detected_country: result.detectedCountry ?? null,
        country_confidence: result.countryConfidence ?? null,
        country_signals: (result.countrySignals ?? null) as Json | null
      })
      .eq("id", row.id);

    if (error) {
      return { kind: "failed", id: row.id, error: error.message };
    }
  }

  if (result.detectedCountry) {
    return {
      kind: "detected",
      id: row.id,
      country: result.detectedCountry,
      confidence: result.countryConfidence ?? 0
    };
  }
  return { kind: "unknown", id: row.id };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const supabase = buildAdminClient();

  let query = supabase
    .from("captured_emails")
    .select(
      "id, subject, html_content, plain_text, sender_email, company_id, detected_country, country_signals"
    )
    .not("company_id", "is", null)
    .order("received_at", { ascending: false });

  // Row selection:
  //  --thin  → already-attempted rows (re-read the shaky English/.com ones)
  //  default → only rows we've never attempted (country_signals is null)
  //  --force → everything
  if (opts.thin) {
    query = query.not("country_signals", "is", null);
  } else if (!opts.force) {
    query = query.is("country_signals", null);
  }

  if (opts.onlyCompanies && opts.onlyCompanies.size > 0) {
    query = query.in("company_id", Array.from(opts.onlyCompanies));
  }

  if (opts.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load captured_emails:", error.message);
    process.exit(1);
  }

  let rows = (data ?? []) as Row[];

  // --thin: narrow to the rows where the model had no concrete signal — English
  // copy and no real country TLD. These are the only ones at risk of being a
  // default-to-US guess; everything else already rests on a footer / non-English
  // language / real ccTLD and is left untouched.
  if (opts.thin) {
    rows = rows.filter((row) => {
      const sig = row.country_signals as
        | { language?: string | null; tld?: string | null }
        | null;
      const language = sig?.language ?? null;
      const tld = sig?.tld ?? null;
      return language === "en" && tld === null;
    });
  }

  console.log(
    `Backfill plan: ${rows.length} email(s) | dry-run=${opts.dryRun} | force=${opts.force} | thin=${opts.thin} | concurrency=${opts.concurrency}`
  );
  if (opts.onlyCompanies) {
    console.log(`  only companies: ${[...opts.onlyCompanies].join(", ")}`);
  }

  let detected = 0;
  let unknown = 0;
  let errored = 0;
  let failed = 0;
  const byCountry: Record<string, number> = {};
  const affectedCompanies = new Set<string>();

  await runWithConcurrency(rows, opts.concurrency, async (row, index) => {
    const outcome = await processRow(supabase, row, opts);
    const position = `[${index + 1}/${rows.length}]`;

    switch (outcome.kind) {
      case "detected": {
        detected += 1;
        byCountry[outcome.country] = (byCountry[outcome.country] ?? 0) + 1;
        if (row.company_id) affectedCompanies.add(row.company_id);
        console.log(
          `${position} ${outcome.id} -> ${outcome.country} (conf=${outcome.confidence.toFixed(2)})`
        );
        break;
      }
      case "unknown": {
        unknown += 1;
        if (row.company_id) affectedCompanies.add(row.company_id);
        console.log(`${position} ${outcome.id} -> unknown`);
        break;
      }
      case "errored": {
        errored += 1;
        console.error(`${position} ${outcome.id} LLM error (retryable): ${outcome.error}`);
        break;
      }
      case "failed": {
        failed += 1;
        console.error(`${position} ${outcome.id} FAILED: ${outcome.error}`);
        break;
      }
    }
  });

  console.log("\nPhase 1 (per-email detection)");
  console.log(`  detected: ${detected}`);
  console.log(`  unknown:  ${unknown}`);
  console.log(`  errored:  ${errored} (retryable — rerun to fill)`);
  console.log(`  failed:   ${failed}`);
  if (Object.keys(byCountry).length > 0) {
    console.log("\nDetected countries");
    for (const [country, n] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(3)}  ${country}`);
    }
  }

  // Phase 2: roll up affected companies' primary market from their emails.
  if (!opts.dryRun && affectedCompanies.size > 0) {
    console.log(`\nPhase 2 (brand rollup): ${affectedCompanies.size} compan(ies)`);
    const companyIds = [...affectedCompanies];
    const marketTally: Record<string, number> = {};
    let companiesUnknown = 0;
    let rollupFailed = 0;

    await runWithConcurrency(companyIds, 4, async (companyId) => {
      try {
        const rollup = await recomputeCompanyMarket(companyId);
        if (rollup.country) {
          marketTally[rollup.country] = (marketTally[rollup.country] ?? 0) + 1;
        } else {
          companiesUnknown += 1;
        }
      } catch (error) {
        rollupFailed += 1;
        console.error(
          `  rollup FAILED for ${companyId}: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
    });

    console.log("\nBrand primary markets");
    for (const [country, n] of Object.entries(marketTally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(3)}  ${country}`);
    }
    console.log(`  ${companiesUnknown.toString().padStart(3)}  unknown`);
    if (rollupFailed > 0) {
      console.log(`  rollup failures: ${rollupFailed}`);
    }
  } else if (opts.dryRun) {
    console.log("\nDry run — no rows were modified, brand rollup skipped.");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Backfill crashed:", error);
  process.exit(1);
});
