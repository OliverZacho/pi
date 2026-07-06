/**
 * Extracts stated offer deadlines for existing discount emails.
 *
 * Rows captured before the offer_ends_on / offer_is_extension signal shipped
 * (2026-07-06) have both columns null, so the discount timeline renders them
 * as bare dots. This re-runs the classifier with the send date attached and
 * writes ONLY the two offer-window columns — category, discount, promo code
 * and every other classification field are left exactly as they are.
 *
 * Targeted single-row updates of two small columns; deliberately nothing like
 * the whole-table rewrites that caused the 2026-07-06 WAL blowup.
 *
 * Run with:
 *   npx --yes tsx --conditions=react-server scripts/backfill-offer-deadlines.ts
 *
 * Flags:
 *   --dry-run         Don't write anything, just print what would be stored.
 *   --company=<id>    Only process rows belonging to <id>. Repeatable.
 *   --limit=<n>       Process at most <n> rows. Useful for spot-checks.
 *   --concurrency=<n> Max parallel LLM calls. Defaults to 2 to stay polite.
 *   --all             Also re-process rows that already carry the signal
 *                     (default skips rows where offer_is_extension is set,
 *                     the marker that extraction already ran).
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
  sender_email: string;
  sent_at: string | null;
  received_at: string;
  discount_percent: number | null;
  offer_ends_on: string | null;
  offer_is_extension: boolean | null;
};

type CliOptions = {
  dryRun: boolean;
  onlyCompanies: Set<string> | null;
  limit: number | null;
  concurrency: number;
  all: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    onlyCompanies: null,
    limit: null,
    concurrency: 2,
    all: false
  };

  for (const raw of argv) {
    if (raw === "--dry-run") {
      opts.dryRun = true;
    } else if (raw === "--all") {
      opts.all = true;
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

type ProcessResult =
  | {
      kind: "written";
      id: string;
      endsOn: string | null;
      isExtension: boolean | null;
    }
  | { kind: "skipped"; id: string; reason: string }
  | { kind: "failed"; id: string; error: string };

async function processRow(
  supabase: SupabaseClient<Database>,
  row: Row,
  opts: CliOptions
): Promise<ProcessResult> {
  const sentAt = row.sent_at ?? row.received_at;

  let result;
  try {
    result = await classifyEmail({
      subject: row.subject,
      html: row.html_content,
      plainText: row.plain_text ?? undefined,
      senderDomain: row.sender_email,
      sentAt
    });
  } catch (error) {
    return {
      kind: "failed",
      id: row.id,
      error: error instanceof Error ? error.message : "unknown error"
    };
  }

  if (result.llmError) {
    // Without a real model pass there is nothing trustworthy to store —
    // leaving the row null keeps it eligible for a retry run.
    return { kind: "failed", id: row.id, error: result.llmError };
  }

  const endsOn = result.offerEndsOn ?? null;
  const isExtension = result.offerIsExtension ?? null;

  if (!opts.dryRun) {
    const { error } = await supabase
      .from("captured_emails")
      .update({
        offer_ends_on: endsOn,
        offer_is_extension: isExtension
      })
      .eq("id", row.id);

    if (error) {
      return { kind: "failed", id: row.id, error: error.message };
    }
  }

  return { kind: "written", id: row.id, endsOn, isExtension };
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
      "id, subject, html_content, plain_text, sender_email, sent_at, received_at, discount_percent, offer_ends_on, offer_is_extension"
    )
    .gt("discount_percent", 0)
    .order("received_at", { ascending: false });

  if (!opts.all) {
    // offer_is_extension is non-null on any row the extractor has already
    // seen (it returns true/false for every email carrying an offer), so
    // null is the "never processed" marker and reruns stay idempotent.
    query = query.is("offer_is_extension", null);
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

  const rows = (data ?? []) as Row[];

  console.log(
    `Backfill plan: ${rows.length} discount email(s) | dry-run=${opts.dryRun} | concurrency=${opts.concurrency} | all=${opts.all}`
  );
  if (opts.onlyCompanies) {
    console.log(`  only companies: ${[...opts.onlyCompanies].join(", ")}`);
  }

  let written = 0;
  let withDeadline = 0;
  let extensions = 0;
  let failed = 0;

  await runWithConcurrency(rows, opts.concurrency, async (row, index) => {
    const outcome = await processRow(supabase, row, opts);
    const position = `[${index + 1}/${rows.length}]`;

    switch (outcome.kind) {
      case "written": {
        written += 1;
        if (outcome.endsOn) withDeadline += 1;
        if (outcome.isExtension) extensions += 1;
        console.log(
          `${position} ${outcome.id} ends_on=${outcome.endsOn ?? "null"} extension=${
            outcome.isExtension ?? "null"
          }`
        );
        break;
      }
      case "skipped": {
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
  console.log(`  processed:      ${written}`);
  console.log(`  with deadline:  ${withDeadline}`);
  console.log(`  extensions:     ${extensions}`);
  console.log(`  failed:         ${failed}`);
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
