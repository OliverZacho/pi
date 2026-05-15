/**
 * Re-runs `extractColorPalette` over captured_email rows and writes the
 * resulting palette into `metadata.palette_colors`.
 *
 * Use this once after deploying the palette extractor so historical rows
 * (which were ingested before the field existed) get retro-populated. The
 * extractor is purely deterministic over the stored HTML — no network calls,
 * no LLM — so this is safe and free to re-run.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-palette.ts
 *
 * Flags:
 *   --dry-run          Don't write anything, just print would-be updates.
 *   --all              Re-extract on every row (default: only rows whose
 *                      `metadata->'palette_colors'` IS NULL).
 *   --limit=<n>        Process at most <n> rows.
 *   --concurrency=<n>  Max parallel updates. Defaults to 4.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractColorPalette, type PaletteColor } from "../lib/extract-metadata";
import type { Database, Json } from "../types/supabase";

type Row = {
  id: string;
  subject: string;
  html_content: string | null;
  metadata: Json | null;
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
      palette: PaletteColor[];
      previousLength: number;
    }
  | { kind: "unchanged"; id: string; length: number }
  | { kind: "skipped"; id: string; reason: string }
  | { kind: "failed"; id: string; error: string };

function existingPaletteLength(metadata: Json | null): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 0;
  }
  const candidate = (metadata as Record<string, unknown>).palette_colors;
  return Array.isArray(candidate) ? candidate.length : 0;
}

async function processRow(
  supabase: SupabaseClient<Database>,
  row: Row,
  opts: CliOptions
): Promise<Outcome> {
  try {
    const html = row.html_content ?? "";
    if (!html) {
      return { kind: "skipped", id: row.id, reason: "no html_content" };
    }

    const palette = extractColorPalette(html);
    const previousLength = existingPaletteLength(row.metadata);

    if (palette.length === 0 && previousLength === 0) {
      return { kind: "unchanged", id: row.id, length: 0 };
    }

    if (opts.dryRun) {
      return { kind: "updated", id: row.id, palette, previousLength };
    }

    const existingMetadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const nextMetadata = {
      ...existingMetadata,
      palette_colors: palette
    } as Json;

    const { error } = await supabase
      .from("captured_emails")
      .update({ metadata: nextMetadata })
      .eq("id", row.id);

    if (error) {
      return { kind: "failed", id: row.id, error: error.message };
    }

    return { kind: "updated", id: row.id, palette, previousLength };
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
    .select("id, subject, html_content, metadata")
    .order("received_at", { ascending: false });

  if (!opts.allRows) {
    query = query.is("metadata->palette_colors", null);
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
    `Palette backfill plan: ${rows.length} row(s) | dry-run=${opts.dryRun} | scope=${opts.allRows ? "all" : "metadata.palette_colors IS NULL"} | concurrency=${opts.concurrency}`
  );

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  let totalSwatches = 0;

  await runWithConcurrency(rows, opts.concurrency, async (row, index) => {
    const outcome = await processRow(supabase, row, opts);
    const position = `[${index + 1}/${rows.length}]`;
    switch (outcome.kind) {
      case "updated": {
        updated += 1;
        totalSwatches += outcome.palette.length;
        const previewHexes = outcome.palette.slice(0, 5).map((c) => c.hex).join(" ");
        console.log(
          `${position} ${outcome.id} ${outcome.previousLength} -> ${outcome.palette.length} colors  ${previewHexes}`
        );
        break;
      }
      case "unchanged":
        unchanged += 1;
        console.log(
          `${position} ${outcome.id} ${outcome.length} colors — unchanged`
        );
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
  console.log(`  updated:        ${updated}`);
  console.log(`  unchanged:      ${unchanged}`);
  console.log(`  skipped:        ${skipped}`);
  console.log(`  failed:         ${failed}`);
  if (updated > 0) {
    const avg = (totalSwatches / updated).toFixed(1);
    console.log(`  avg swatches:   ${avg} per updated row`);
  }
  if (opts.dryRun) {
    console.log("\nDry run — no rows were modified.");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Palette backfill crashed:", error);
  process.exit(1);
});
