/**
 * Classifies captured_email rows into perceptual colour buckets and writes the
 * result to the `color_buckets` column that powers the Explore colour filter.
 *
 * The buckets are an *area share* of the email's content-image pixels, so this
 * re-downloads and re-samples those images (via `extractImagePaletteForEmail`)
 * rather than reading the stored palette — the stored `image_palette` is
 * saturation-biased and background-stripped, which can't answer "how much of the
 * email is this colour". Rows with no analysable images fall back to the
 * count-based HTML `palette_colors`. Because it fetches image bytes it is slower
 * and not free to re-run, but it is deterministic and side-effect-free besides
 * the single column write.
 *
 * Writes only the single `color_buckets` column (never rewrites the row / its
 * metadata) to keep WAL churn minimal — see the 2026-07-06 disk-autoscale note.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-color-buckets.ts --dry-run
 *   npx --yes tsx scripts/backfill-color-buckets.ts
 *
 * Flags:
 *   --dry-run          Don't write; print the buckets each row would get.
 *   --all              Re-classify every row (default: only rows whose
 *                      `color_buckets` IS NULL).
 *   --limit=<n>        Process at most <n> rows.
 *   --concurrency=<n>  Max parallel rows (downloads + update). Defaults to 4.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyPaletteBuckets } from "../lib/color-buckets";
import { extractImagePaletteForEmail } from "../lib/extract-image-palette";
import type { Database, Json } from "../types/supabase";

type Row = {
  id: string;
  image_urls: Json | null;
  metadata: Json | null;
  color_buckets: string[] | null;
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
  | { kind: "updated"; id: string; buckets: string[]; previous: string[] }
  | { kind: "unchanged"; id: string; buckets: string[] }
  | { kind: "failed"; id: string; error: string };

/** The HTML token palette, used only when an email has no analysable images. */
function readHtmlPalette(metadata: Json | null): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return (metadata as Record<string, unknown>).palette_colors ?? null;
}

function sameBuckets(a: string[], b: string[] | null): boolean {
  const prev = b ?? [];
  if (a.length !== prev.length) return false;
  // Order matters (strongest-first) and is stable, so compare positionally.
  return a.every((value, i) => value === prev[i]);
}

async function processRow(
  supabase: SupabaseClient<Database>,
  row: Row,
  opts: CliOptions
): Promise<Outcome> {
  try {
    // Re-sample the mirrored content images for a true area-share classification.
    const paths = Array.isArray(row.image_urls) ? (row.image_urls as string[]) : [];
    const { palette, buckets: imageBuckets } = await extractImagePaletteForEmail(paths);
    const buckets =
      palette.length > 0
        ? imageBuckets
        : classifyPaletteBuckets(readHtmlPalette(row.metadata));
    const previous = row.color_buckets ?? [];

    if (sameBuckets(buckets, row.color_buckets)) {
      return { kind: "unchanged", id: row.id, buckets };
    }

    if (opts.dryRun) {
      return { kind: "updated", id: row.id, buckets, previous };
    }

    const { error } = await supabase
      .from("captured_emails")
      .update({ color_buckets: buckets })
      .eq("id", row.id);

    if (error) {
      return { kind: "failed", id: row.id, error: error.message };
    }

    return { kind: "updated", id: row.id, buckets, previous };
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

  // Rebuild the query per page: a Supabase builder is single-use once awaited.
  const pageQuery = (start: number, end: number) => {
    let q = supabase
      .from("captured_emails")
      .select("id, image_urls, metadata, color_buckets")
      .order("received_at", { ascending: false })
      .order("id", { ascending: false });
    if (!opts.allRows) {
      q = q.is("color_buckets", null);
    }
    return q.range(start, end);
  };

  // PostgREST caps a single response at 1000 rows, so page through with
  // .range() until a short page signals the end (or --limit is reached).
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    const target = opts.limit ? Math.min(PAGE, opts.limit - rows.length) : PAGE;
    if (target <= 0) break;
    const { data, error } = await pageQuery(start, start + target - 1);
    if (error) {
      console.error("Failed to load captured_emails:", error.message);
      process.exit(1);
    }
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < target) break;
  }
  console.log(
    `Colour-bucket backfill plan: ${rows.length} row(s) | dry-run=${opts.dryRun} | scope=${opts.allRows ? "all" : "color_buckets IS NULL"} | concurrency=${opts.concurrency}`
  );

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const tally = new Map<string, number>();

  await runWithConcurrency(rows, opts.concurrency, async (row, index) => {
    const outcome = await processRow(supabase, row, opts);
    const position = `[${index + 1}/${rows.length}]`;
    switch (outcome.kind) {
      case "updated": {
        updated += 1;
        for (const bucket of outcome.buckets) {
          tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
        }
        console.log(
          `${position} ${outcome.id} [${outcome.previous.join(", ")}] -> [${outcome.buckets.join(", ")}]`
        );
        break;
      }
      case "unchanged":
        unchanged += 1;
        for (const bucket of outcome.buckets) {
          tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
        }
        break;
      case "failed":
        failed += 1;
        console.error(`${position} ${outcome.id} FAILED: ${outcome.error}`);
        break;
    }
  });

  console.log("\nSummary");
  console.log(`  updated:        ${updated}`);
  console.log(`  unchanged:      ${unchanged}`);
  console.log(`  failed:         ${failed}`);
  console.log("\nBucket distribution (rows tagged with each colour):");
  for (const bucket of Array.from(tally.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${bucket[0].padEnd(8)} ${bucket[1]}`);
  }
  if (opts.dryRun) {
    console.log("\nDry run — no rows were modified.");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Colour-bucket backfill crashed:", error);
  process.exit(1);
});
