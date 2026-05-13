/**
 * Re-runs ESP detection over captured_email rows using the current fingerprint
 * library and updates `esp_provider`, `esp_confidence`, `esp_signals`, and
 * `metadata.esp_candidates`.
 *
 * Use this after enhancing `lib/esp-detect.ts` (e.g. adding a new provider or
 * a CNAMEd tracking-domain shape) so historical rows that were ingested
 * before the patterns existed get re-classified instead of staying frozen at
 * whatever the code knew at ingest time. ESP detection is purely
 * deterministic over the stored HTML + headers, so no LLM calls are involved.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-esp.ts
 *
 * Flags:
 *   --dry-run               Don't write anything, just print would-be updates.
 *   --all                   Re-run on every row (default: only rows whose
 *                           `esp_provider IS NULL`).
 *   --limit=<n>             Process at most <n> rows.
 *   --concurrency=<n>       Max parallel updates. Defaults to 4.
 *   --only-provider=<name>  When combined with --all, only rewrite rows whose
 *                           current esp_provider matches <name> (e.g. "unknown",
 *                           "salesforce_mc"). Repeatable.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { detectEsp, type EspProvider } from "../lib/esp-detect";
import { extractMetadata } from "../lib/extract-metadata";
import type { Database, Json } from "../types/supabase";

type Row = {
  id: string;
  subject: string;
  html_content: string;
  plain_text: string | null;
  esp_provider: string | null;
  esp_confidence: number | string | null;
  raw_payload: Json | null;
  metadata: Json | null;
};

type CliOptions = {
  dryRun: boolean;
  allRows: boolean;
  limit: number | null;
  concurrency: number;
  onlyProviders: Set<string> | null;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    allRows: false,
    limit: null,
    concurrency: 4,
    onlyProviders: null
  };

  for (const raw of argv) {
    if (raw === "--dry-run") {
      opts.dryRun = true;
    } else if (raw === "--all") {
      opts.allRows = true;
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
    } else if (raw.startsWith("--only-provider=")) {
      const value = raw.slice("--only-provider=".length).trim();
      if (value) {
        if (!opts.onlyProviders) {
          opts.onlyProviders = new Set();
        }
        opts.onlyProviders.add(value);
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

function extractHeaders(raw: Json | null): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const full = (raw as Record<string, unknown>).full;
  if (!full || typeof full !== "object" || Array.isArray(full)) return null;
  const headers = (full as Record<string, unknown>).headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

type Outcome =
  | {
      kind: "updated";
      id: string;
      before: { provider: string | null; confidence: number };
      after: { provider: EspProvider; confidence: number };
    }
  | {
      kind: "unchanged";
      id: string;
      provider: string | null;
      confidence: number;
    }
  | { kind: "failed"; id: string; error: string };

async function processRow(
  supabase: SupabaseClient<Database>,
  row: Row,
  opts: CliOptions
): Promise<Outcome> {
  try {
    const html = row.html_content ?? "";
    const headers = extractHeaders(row.raw_payload);
    const metadata = extractMetadata({
      subject: row.subject ?? "",
      html,
      plainText: row.plain_text ?? undefined,
      mirroredAssets: [],
      headers
    });
    const result = detectEsp({
      headers,
      html,
      links: metadata.links,
      resourceHosts: metadata.resource_hosts
    });

    const beforeProvider = row.esp_provider ?? null;
    const beforeConfidence =
      row.esp_confidence === null || row.esp_confidence === undefined
        ? 0
        : Number(row.esp_confidence);

    const nextProvider = result.provider === "unknown" ? null : result.provider;
    const nextConfidence = result.confidence;

    const providerChanged = (beforeProvider ?? null) !== (nextProvider ?? null);
    const confidenceChanged =
      Math.abs(beforeConfidence - nextConfidence) > 0.0005;

    if (!providerChanged && !confidenceChanged) {
      return {
        kind: "unchanged",
        id: row.id,
        provider: beforeProvider,
        confidence: beforeConfidence
      };
    }

    if (opts.dryRun) {
      return {
        kind: "updated",
        id: row.id,
        before: { provider: beforeProvider, confidence: beforeConfidence },
        after: { provider: result.provider, confidence: nextConfidence }
      };
    }

    const existingMetadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const nextMetadata = {
      ...existingMetadata,
      esp_candidates: result.candidates
    } as Json;

    const { error } = await supabase
      .from("captured_emails")
      .update({
        esp_provider: nextProvider,
        esp_confidence: nextConfidence,
        esp_signals: result.signals as unknown as Json,
        metadata: nextMetadata
      })
      .eq("id", row.id);

    if (error) {
      return { kind: "failed", id: row.id, error: error.message };
    }

    return {
      kind: "updated",
      id: row.id,
      before: { provider: beforeProvider, confidence: beforeConfidence },
      after: { provider: result.provider, confidence: nextConfidence }
    };
  } catch (error) {
    return {
      kind: "failed",
      id: row.id,
      error: error instanceof Error ? error.message : "unknown error"
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = cursor;
        cursor += 1;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const supabase = buildAdminClient();

  let query = supabase
    .from("captured_emails")
    .select("id, subject, html_content, plain_text, esp_provider, esp_confidence, raw_payload, metadata")
    .order("received_at", { ascending: false });

  if (!opts.allRows) {
    query = query.is("esp_provider", null);
  } else if (opts.onlyProviders && opts.onlyProviders.size > 0) {
    query = query.in("esp_provider", Array.from(opts.onlyProviders));
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
    `ESP backfill plan: ${rows.length} row(s) | dry-run=${opts.dryRun} | scope=${opts.allRows ? "all" : "esp_provider IS NULL"} | concurrency=${opts.concurrency}`
  );

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const providerCounts: Record<string, number> = {};

  await runWithConcurrency(rows, opts.concurrency, async (row, index) => {
    const outcome = await processRow(supabase, row, opts);
    const position = `[${index + 1}/${rows.length}]`;
    switch (outcome.kind) {
      case "updated": {
        updated += 1;
        providerCounts[outcome.after.provider] =
          (providerCounts[outcome.after.provider] ?? 0) + 1;
        const before = outcome.before.provider ?? "null";
        const after = outcome.after.provider;
        console.log(
          `${position} ${outcome.id} ${before} (${outcome.before.confidence.toFixed(2)}) -> ${after} (${outcome.after.confidence.toFixed(2)})`
        );
        break;
      }
      case "unchanged":
        unchanged += 1;
        console.log(
          `${position} ${outcome.id} ${outcome.provider ?? "null"} (${outcome.confidence.toFixed(2)}) — unchanged`
        );
        break;
      case "failed":
        failed += 1;
        console.error(`${position} ${outcome.id} FAILED: ${outcome.error}`);
        break;
    }
  });

  console.log("\nSummary");
  console.log(`  updated:   ${updated}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  failed:    ${failed}`);
  if (Object.keys(providerCounts).length > 0) {
    console.log("\nNew provider assignments");
    for (const [key, n] of Object.entries(providerCounts).sort((a, b) => b[1] - a[1])) {
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
  console.error("ESP backfill crashed:", error);
  process.exit(1);
});
