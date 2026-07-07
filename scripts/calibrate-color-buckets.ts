/**
 * Read-only calibration harness for the area-share colour buckets.
 *
 * Re-extracts a set of emails (by id, or a per-leading-bucket sample) and prints
 * the CURRENT stored `color_buckets` next to the NEW area-based classification,
 * including each bucket's share of the sampled area — so the AREA_DOMINANCE
 * thresholds in lib/extract-image-palette.ts can be tuned before any DB write.
 * Never writes.
 *
 * Run with:
 *   npx --yes tsx scripts/calibrate-color-buckets.ts <id> [<id> ...]
 *   npx --yes tsx scripts/calibrate-color-buckets.ts --sample=6
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractImagePaletteForEmail } from "../lib/extract-image-palette";
import { classifyPaletteBuckets } from "../lib/color-buckets";
import type { Database, Json } from "../types/supabase";

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
    if (!(key in process.env)) process.env[key] = value;
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
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

type Row = {
  id: string;
  image_urls: Json | null;
  metadata: Json | null;
  color_buckets: string[] | null;
};

function readHtmlPalette(metadata: Json | null): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return (metadata as Record<string, unknown>).palette_colors ?? null;
}

async function pickSampleIds(
  supabase: SupabaseClient<Database>,
  perBucket: number
): Promise<string[]> {
  const buckets = ["red", "green", "blue", "pink", "yellow", "purple", "beige", "black"];
  const ids: string[] = [];
  for (const bucket of buckets) {
    const { data } = await supabase
      .from("captured_emails")
      .select("id")
      .contains("color_buckets", [bucket])
      .not("image_urls", "is", null)
      .order("id", { ascending: true })
      .limit(perBucket);
    for (const r of data ?? []) ids.push(r.id);
  }
  return ids;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const supabase = buildAdminClient();

  const args = process.argv.slice(2);
  const sampleArg = args.find((a) => a.startsWith("--sample="));
  let ids = args.filter((a) => !a.startsWith("--"));
  if (sampleArg) {
    const per = Number.parseInt(sampleArg.slice("--sample=".length), 10) || 3;
    ids = [...ids, ...(await pickSampleIds(supabase, per))];
  }
  if (ids.length === 0) {
    console.error("Pass email ids and/or --sample=<n>.");
    process.exit(1);
  }

  const { data, error } = await supabase
    .from("captured_emails")
    .select("id, image_urls, metadata, color_buckets")
    .in("id", ids);
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  let changed = 0;
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      console.log(`${id}  (not found)`);
      continue;
    }
    const paths = Array.isArray(row.image_urls) ? (row.image_urls as string[]) : [];
    const { palette, buckets, bucketShares } = await extractImagePaletteForEmail(paths);
    const next =
      palette.length > 0 ? buckets : classifyPaletteBuckets(readHtmlPalette(row.metadata));
    const prev = row.color_buckets ?? [];
    const shareStr = bucketShares
      .map((s) => `${s.key} ${(s.share * 100).toFixed(1)}%`)
      .join(", ");
    const flag = prev.join(",") !== next.join(",") ? " *" : "";
    if (flag) changed++;
    console.log(
      `${id}${flag}\n  was:    [${prev.join(", ")}]\n  now:    [${next.join(", ")}]` +
        `${palette.length === 0 ? "  (html fallback)" : ""}\n  shares: ${shareStr || "(none)"}`
    );
  }
  console.log(`\n${ids.length} row(s), ${changed} changed.`);
}

main().catch((e) => {
  console.error("calibration crashed:", e);
  process.exit(1);
});
