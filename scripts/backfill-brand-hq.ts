/**
 * Brand-level HQ / global resolution via Sonnet + web search.
 *
 * Fills the gap text classification can't: brands whose address is a footer
 * *image*, anonymous English `.com` brands, and the global-vs-national question.
 * Runs once per brand. Default target is the "web-eligible" set — brands with no
 * non-English email signal (a non-English/localized list is authoritative and
 * left alone). The web answer then sets `primary_market_country` (HQ) or flags
 * `is_global`, with provenance in `market_source` / `market_citation`.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-brand-hq.ts --dry-run --only=Gisou --only="&Tradition"
 *   npx --yes tsx scripts/backfill-brand-hq.ts            # all web-eligible brands
 *
 * Flags:
 *   --dry-run            Print answers, write nothing.
 *   --only=<name>        Only this brand (repeatable). Bypasses eligibility.
 *   --limit=<n>          Cap the number of brands.
 *   --min-confidence=<f> Skip writing answers below this confidence (default 0.5).
 *   --concurrency=<n>    Parallel lookups (default 2).
 *   --min-interval=<ms>  Min spacing between lookups (default 3000).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { lookupBrandOrigin } from "../lib/brand-hq-lookup";
import type { Database, Json } from "../types/supabase";

type Brand = { id: string; name: string; domain: string | null };

type CliOptions = {
  dryRun: boolean;
  only: Set<string> | null;
  limit: number | null;
  minConfidence: number;
  concurrency: number;
  minIntervalMs: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    only: null,
    limit: null,
    minConfidence: 0.5,
    concurrency: 2,
    minIntervalMs: 3000
  };
  for (const raw of argv) {
    if (raw === "--dry-run") opts.dryRun = true;
    else if (raw.startsWith("--only=")) {
      const v = raw.slice("--only=".length).trim();
      if (v) (opts.only ??= new Set()).add(v.toLowerCase());
    } else if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) opts.limit = n;
    } else if (raw.startsWith("--min-confidence=")) {
      const n = Number.parseFloat(raw.slice("--min-confidence=".length));
      if (Number.isFinite(n)) opts.minConfidence = n;
    } else if (raw.startsWith("--concurrency=")) {
      const n = Number.parseInt(raw.slice("--concurrency=".length), 10);
      if (Number.isFinite(n) && n > 0) opts.concurrency = n;
    } else if (raw.startsWith("--min-interval=")) {
      const n = Number.parseInt(raw.slice("--min-interval=".length), 10);
      if (Number.isFinite(n) && n >= 0) opts.minIntervalMs = n;
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
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function buildAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function selectBrands(
  supabase: SupabaseClient<Database>,
  opts: CliOptions
): Promise<Brand[]> {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, domain")
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("Failed to load companies:", error.message);
    process.exit(1);
  }
  let brands = (companies ?? []) as Brand[];

  if (opts.only) {
    brands = brands.filter((b) => opts.only!.has(b.name.toLowerCase()));
  } else {
    // Web-eligible = no non-English email signal (those are authoritative).
    const { data: nonEnglish, error: neErr } = await supabase
      .from("captured_emails")
      .select("company_id, country_signals")
      .not("detected_country", "is", null);
    if (neErr) {
      console.error("Failed to load signals:", neErr.message);
      process.exit(1);
    }
    const excluded = new Set<string>();
    for (const row of nonEnglish ?? []) {
      const sig = row.country_signals as { language?: string | null } | null;
      if (sig && sig.language && sig.language !== "en" && row.company_id) {
        excluded.add(row.company_id);
      }
    }
    brands = brands.filter((b) => !excluded.has(b.id));
  }

  if (opts.limit) brands = brands.slice(0, opts.limit);
  return brands;
}

let nextSlotAt = 0;
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function acquireSlot(ms: number): Promise<void> {
  if (ms <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + ms;
  if (slot - now > 0) await sleep(slot - now);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

function label(country: string | null, isGlobal: boolean): string {
  if (isGlobal) return country ? `GLOBAL (hq ${country})` : "GLOBAL";
  return country ?? "unknown";
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const supabase = buildAdminClient();
  const brands = await selectBrands(supabase, opts);

  console.log(
    `HQ lookup: ${brands.length} brand(s) | dry-run=${opts.dryRun} | min-confidence=${opts.minConfidence} | concurrency=${opts.concurrency}`
  );

  const tally: Record<string, number> = {};
  let written = 0;
  let skipped = 0;
  let failed = 0;

  await runWithConcurrency(brands, opts.concurrency, async (brand, index) => {
    const position = `[${index + 1}/${brands.length}]`;
    // Web-search calls are token-heavy and Sonnet's input-TPM limit is low, so
    // retry rate limits with backoff on top of the steady-state pacer.
    let res = await (async () => {
      for (let attempt = 0; ; attempt += 1) {
        await acquireSlot(opts.minIntervalMs);
        const r = await lookupBrandOrigin({ name: brand.name, domain: brand.domain });
        if (r.error && /429|rate_limit/i.test(r.error) && attempt < 6) {
          await sleep(Math.min(60_000, 8_000 * 2 ** attempt) + Math.random() * 1_000);
          continue;
        }
        return r;
      }
    })();

    if (res.error) {
      failed += 1;
      console.error(`${position} ${brand.name} FAILED: ${res.error}`);
      return;
    }

    const result = label(res.country, res.isGlobal);
    const src = res.sources[0]?.url ? ` · ${res.sources[0].url}` : "";
    console.log(
      `${position} ${brand.name} -> ${result} (conf=${res.confidence.toFixed(2)})${src}`
    );
    console.log(`       ${res.reasoning}`);

    const key = res.isGlobal ? "GLOBAL" : res.country ?? "unknown";
    tally[key] = (tally[key] ?? 0) + 1;

    const usable = (res.isGlobal || res.country !== null) && res.confidence >= opts.minConfidence;
    if (opts.dryRun || !usable) {
      if (!opts.dryRun && !usable) skipped += 1;
      return;
    }

    const { error } = await supabase
      .from("companies")
      .update({
        // Global brands keep their HQ country so they still group by send-time
        // timezone; is_global is an additional flag, not a country replacement.
        primary_market_country: res.country,
        hq_country: res.country,
        is_global: res.isGlobal,
        market_confidence: res.confidence,
        market_source: "web",
        market_resolved_at: new Date().toISOString(),
        market_citation: {
          reasoning: res.reasoning,
          confidence: res.confidence,
          model: res.model,
          sources: res.sources
        } as Json
      })
      .eq("id", brand.id);

    if (error) {
      failed += 1;
      console.error(`${position} ${brand.name} write failed: ${error.message}`);
    } else {
      written += 1;
    }
  });

  console.log("\nAnswers");
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${k}`);
  }
  if (!opts.dryRun) {
    console.log(`\nwritten: ${written} | skipped(low-conf/unknown): ${skipped} | failed: ${failed}`);
  } else {
    console.log("\nDry run — nothing written.");
  }
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("HQ backfill crashed:", e);
  process.exit(1);
});
