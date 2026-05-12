/**
 * Re-classifies every captured_email row using the current taxonomy.
 *
 * Use after a taxonomy change (e.g. adding `welcome` / `products`) so existing
 * rows get assigned to the new buckets instead of staying frozen at whatever
 * category they were given at ingest time.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-categories.ts
 *
 * Flags:
 *   --dry-run         Don't write anything, just print the new assignments.
 *   --only=<cat>      Only consider rows currently in category <cat> (repeatable
 *                     by passing --only multiple times). Defaults to every row.
 *   --include-manual  Re-classify rows whose classification_source = 'manual'.
 *                     Off by default — manual overrides are preserved.
 *   --limit=<n>       Process at most <n> rows. Useful for spot-checks.
 *   --concurrency=<n> Max parallel LLM calls. Defaults to 2 to stay polite.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyEmail } from "../lib/classify";
import type { Database } from "../types/supabase";

type Row = {
  id: string;
  subject: string;
  html_content: string;
  plain_text: string | null;
  category: string;
  classification_source: string;
};

type CliOptions = {
  dryRun: boolean;
  includeManual: boolean;
  onlyCategories: Set<string> | null;
  limit: number | null;
  concurrency: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    includeManual: false,
    onlyCategories: null,
    limit: null,
    concurrency: 2
  };

  for (const raw of argv) {
    if (raw === "--dry-run") {
      opts.dryRun = true;
    } else if (raw === "--include-manual") {
      opts.includeManual = true;
    } else if (raw.startsWith("--only=")) {
      const value = raw.slice("--only=".length);
      if (!opts.onlyCategories) {
        opts.onlyCategories = new Set();
      }
      opts.onlyCategories.add(value);
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

type ProcessResult =
  | {
      kind: "updated";
      id: string;
      before: string;
      after: string;
      source: string;
      confidence: number;
    }
  | { kind: "unchanged"; id: string; category: string }
  | { kind: "skipped"; id: string; reason: string }
  | { kind: "failed"; id: string; error: string };

async function processRow(
  supabase: SupabaseClient<Database>,
  row: Row,
  opts: CliOptions
): Promise<ProcessResult> {
  if (!opts.includeManual && row.classification_source === "manual") {
    return { kind: "skipped", id: row.id, reason: "manual classification" };
  }

  let result;
  try {
    result = await classifyEmail({
      subject: row.subject,
      html: row.html_content,
      plainText: row.plain_text ?? undefined
    });
  } catch (error) {
    return {
      kind: "failed",
      id: row.id,
      error: error instanceof Error ? error.message : "unknown error"
    };
  }

  if (opts.dryRun) {
    if (result.category === row.category) {
      return { kind: "unchanged", id: row.id, category: row.category };
    }
    return {
      kind: "updated",
      id: row.id,
      before: row.category,
      after: result.category,
      source: result.source,
      confidence: result.confidence
    };
  }

  const { error } = await supabase
    .from("captured_emails")
    .update({
      category: result.category,
      classification_source: result.source,
      classification_confidence: result.confidence,
      llm_model: result.model ?? null,
      llm_reasoning: result.reasoning ?? null,
      discount_percent: result.discountPercent ?? null,
      discount_amount: result.discountAmount ?? null,
      currency: result.currency ?? null,
      promo_code: result.promoCode ?? null,
      primary_cta_text: result.primaryCtaText ?? null
    })
    .eq("id", row.id);

  if (error) {
    return { kind: "failed", id: row.id, error: error.message };
  }

  if (result.category === row.category) {
    return { kind: "unchanged", id: row.id, category: row.category };
  }

  return {
    kind: "updated",
    id: row.id,
    before: row.category,
    after: result.category,
    source: result.source,
    confidence: result.confidence
  };
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
    .select("id, subject, html_content, plain_text, category, classification_source")
    .order("received_at", { ascending: false });

  if (opts.onlyCategories && opts.onlyCategories.size > 0) {
    query = query.in("category", Array.from(opts.onlyCategories));
  }

  if (opts.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load captured_emails:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  console.log(
    `Backfill plan: ${rows.length} row(s) | dry-run=${opts.dryRun} | include-manual=${opts.includeManual} | concurrency=${opts.concurrency}`
  );
  if (opts.onlyCategories) {
    console.log(`  only categories: ${[...opts.onlyCategories].join(", ")}`);
  }

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  const transitions: Record<string, number> = {};

  await runWithConcurrency(rows, opts.concurrency, async (row, index) => {
    const outcome = await processRow(supabase, row, opts);
    const position = `[${index + 1}/${rows.length}]`;

    switch (outcome.kind) {
      case "updated": {
        updated += 1;
        const key = `${outcome.before} -> ${outcome.after}`;
        transitions[key] = (transitions[key] ?? 0) + 1;
        console.log(
          `${position} ${outcome.id} ${outcome.before} -> ${outcome.after} (source=${outcome.source}, conf=${outcome.confidence.toFixed(2)})`
        );
        break;
      }
      case "unchanged": {
        unchanged += 1;
        console.log(`${position} ${outcome.id} ${outcome.category} (unchanged)`);
        break;
      }
      case "skipped": {
        skipped += 1;
        console.log(`${position} ${outcome.id} skipped: ${outcome.reason}`);
        break;
      }
      case "failed": {
        failed += 1;
        console.error(`${position} ${outcome.id} FAILED: ${outcome.error}`);
        break;
      }
    }
  });

  console.log("\nSummary");
  console.log(`  updated:   ${updated}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  skipped:   ${skipped}`);
  console.log(`  failed:    ${failed}`);
  if (Object.keys(transitions).length > 0) {
    console.log("\nTransitions");
    for (const [key, n] of Object.entries(transitions).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(3)}  ${key}`);
    }
  }
  if (opts.dryRun) {
    console.log("\nDry run — no rows were modified.");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Backfill crashed:", error);
  process.exit(1);
});
