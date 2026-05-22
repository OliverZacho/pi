/**
 * Re-runs `extractListHeaders` over captured_email rows, reading the headers
 * out of the stored Resend payload (`raw_payload->'full'->'headers'`) and
 * writing the result into the dedicated `list_headers` column.
 *
 * Why this exists: the previous extractor only knew the standard RFC 2369 /
 * 8058 shape (`list-unsubscribe: <https://…>`). Resend's `email.received`
 * API normalises inbound MIME via postal-mime and surfaces the List-* family
 * as a single JSON-encoded `list` header. Every email ingested under that
 * pipeline was being misreported as "missing List-Unsubscribe" even though
 * Apple Mail / Gmail render their built-in Unsubscribe buttons just fine.
 * Rerun this once after deploying the extractor fix to retro-correct
 * historical rows.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-list-headers.ts
 *
 * Flags:
 *   --dry-run          Don't write anything, just print would-be updates.
 *   --all              Re-extract on every row (default: only rows whose
 *                      currently-stored `list_headers` flags are all
 *                      `false`/`null` — i.e. the rows the buggy extractor
 *                      would have produced).
 *   --limit=<n>        Process at most <n> rows.
 *   --concurrency=<n>  Max parallel updates. Defaults to 4.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractListHeaders, type ListHeaders } from "../lib/extract-metadata";
import type { Database, Json } from "../types/supabase";

type Row = {
  id: string;
  subject: string;
  raw_payload: Json | null;
  list_headers: Json | null;
};

type CliOptions = {
  dryRun: boolean;
  allRows: boolean;
  limit: number | null;
  concurrency: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    allRows: false,
    limit: null,
    concurrency: 4
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

type Outcome =
  | {
      kind: "updated";
      id: string;
      next: ListHeaders;
      previous: ListHeaders | null;
    }
  | { kind: "unchanged"; id: string; result: ListHeaders | null }
  | { kind: "skipped"; id: string; reason: string }
  | { kind: "failed"; id: string; error: string };

function readHeadersFromPayload(payload: Json | null): Record<string, string> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const full = (payload as Record<string, unknown>).full;
  if (!full || typeof full !== "object" || Array.isArray(full)) {
    return null;
  }
  const headers = (full as Record<string, unknown>).headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof key === "string" && typeof value === "string") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function listHeadersFromColumn(value: Json | null): ListHeaders | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  return {
    has_list_unsubscribe: Boolean(obj.has_list_unsubscribe),
    unsubscribe_mailto:
      typeof obj.unsubscribe_mailto === "string" ? obj.unsubscribe_mailto : null,
    unsubscribe_url:
      typeof obj.unsubscribe_url === "string" ? obj.unsubscribe_url : null,
    has_one_click_post: Boolean(obj.has_one_click_post),
    list_id: typeof obj.list_id === "string" ? obj.list_id : null
  };
}

function listHeadersEqual(a: ListHeaders | null, b: ListHeaders | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.has_list_unsubscribe === b.has_list_unsubscribe &&
    a.unsubscribe_mailto === b.unsubscribe_mailto &&
    a.unsubscribe_url === b.unsubscribe_url &&
    a.has_one_click_post === b.has_one_click_post &&
    a.list_id === b.list_id
  );
}

async function processRow(
  supabase: SupabaseClient<Database>,
  row: Row,
  opts: CliOptions
): Promise<Outcome> {
  try {
    const headers = readHeadersFromPayload(row.raw_payload);
    if (!headers) {
      return { kind: "skipped", id: row.id, reason: "no headers in raw_payload.full" };
    }

    const previous = listHeadersFromColumn(row.list_headers);
    const next = extractListHeaders(headers);

    if (next === null) {
      return { kind: "skipped", id: row.id, reason: "extractor returned null" };
    }

    if (listHeadersEqual(previous, next)) {
      return { kind: "unchanged", id: row.id, result: next };
    }

    if (opts.dryRun) {
      return { kind: "updated", id: row.id, next, previous };
    }

    const { error } = await supabase
      .from("captured_emails")
      .update({ list_headers: next as unknown as Json })
      .eq("id", row.id);

    if (error) {
      return { kind: "failed", id: row.id, error: error.message };
    }

    return { kind: "updated", id: row.id, next, previous };
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
    .select("id, subject, raw_payload, list_headers")
    .order("received_at", { ascending: false });

  if (!opts.allRows) {
    // Only re-extract on rows that the buggy extractor produced an
    // "everything false / null" record for. Rows where the extractor never
    // ran (`list_headers IS NULL`) are also retried — they predate the
    // feature.
    query = query.or(
      "list_headers.is.null,list_headers->>has_list_unsubscribe.eq.false"
    );
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
    `List-headers backfill plan: ${rows.length} row(s) | dry-run=${opts.dryRun} | scope=${opts.allRows ? "all" : "rows the buggy extractor flagged as missing"} | concurrency=${opts.concurrency}`
  );

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  let nowCompliant = 0;
  let nowAnyHeader = 0;

  await runWithConcurrency(rows, opts.concurrency, async (row, index) => {
    const outcome = await processRow(supabase, row, opts);
    const position = `[${index + 1}/${rows.length}]`;
    switch (outcome.kind) {
      case "updated": {
        updated += 1;
        if (outcome.next.has_list_unsubscribe) {
          nowAnyHeader += 1;
        }
        if (
          outcome.next.unsubscribe_url &&
          outcome.next.has_one_click_post
        ) {
          nowCompliant += 1;
        }
        const summary = [
          outcome.next.has_list_unsubscribe ? "list-unsub" : "no-list-unsub",
          outcome.next.unsubscribe_url ? "https" : "no-https",
          outcome.next.has_one_click_post ? "one-click" : "no-one-click",
          outcome.next.list_id ? `id=${outcome.next.list_id}` : "no-id"
        ].join(" | ");
        console.log(`${position} ${outcome.id} ${summary}`);
        break;
      }
      case "unchanged":
        unchanged += 1;
        break;
      case "skipped":
        skipped += 1;
        console.log(`${position} ${outcome.id} skipped (${outcome.reason})`);
        break;
      case "failed":
        failed += 1;
        console.error(`${position} ${outcome.id} FAILED: ${outcome.error}`);
        break;
    }
  });

  console.log("\nSummary");
  console.log(`  updated:                ${updated}`);
  console.log(`  unchanged:              ${unchanged}`);
  console.log(`  skipped:                ${skipped}`);
  console.log(`  failed:                 ${failed}`);
  console.log(`  now has List-Unsub:     ${nowAnyHeader}`);
  console.log(`  now RFC 8058 compliant: ${nowCompliant}`);
  if (opts.dryRun) {
    console.log("\nDry run — no rows were modified.");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("List-headers backfill crashed:", error);
  process.exit(1);
});
