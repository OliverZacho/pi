/**
 * One-off backfill: re-mirror remote images that were dropped at ingest
 * (most often the "image too large: >5MB" failures) for a single email, then
 * patch `image_urls` + `metadata.image_mirror_map` so the preview resolves
 * them to our CDN instead of rendering a broken box.
 *
 * Pairs with the MAX_IMAGE_BYTES bump (5MB -> 10MB) in lib/storage.ts: without
 * that bump the oversized hero fails to fetch again here too.
 *
 * Targets any remote_image_url that isn't already in the mirror map, so it's
 * safe to re-run (already-mirrored URLs are skipped) and only touches the one
 * email you pass.
 *
 *   # dry run (default) — fetch + report, write nothing:
 *   npx --yes tsx scripts/backfill-oversized-hero.ts <emailId>
 *   # actually write:
 *   npx --yes tsx scripts/backfill-oversized-hero.ts <emailId> --write
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv();

import { getSupabaseAdmin } from "../lib/supabase-admin";
import { mirrorRemoteImages } from "../lib/storage";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const emailId = args.find((a) => !a.startsWith("--"));

async function main(): Promise<void> {
  if (!emailId) {
    console.error("Usage: tsx scripts/backfill-oversized-hero.ts <emailId> [--write]");
    process.exit(1);
  }

  const admin = getSupabaseAdmin();

  const { data: row, error } = await admin
    .from("captured_emails")
    .select("id, subject, image_urls, remote_image_urls, metadata")
    .eq("id", emailId)
    .maybeSingle();

  if (error) throw error;
  if (!row) {
    console.error(`No email ${emailId}`);
    process.exit(1);
  }

  console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN"}`);
  console.log(`Email: ${row.subject}\n`);

  const imagePaths: string[] = row.image_urls ?? [];
  const remoteUrls: string[] = row.remote_image_urls ?? [];
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const mirrorMap = { ...((metadata.image_mirror_map as Record<string, string>) ?? {}) };

  const missing = remoteUrls.filter((u) => u && !mirrorMap[u]);
  if (missing.length === 0) {
    console.log("Nothing to do — every remote image is already mirrored.");
    return;
  }

  console.log(`${missing.length} unmirrored remote image(s):`);
  for (const u of missing) console.log(`  - ${u}`);
  console.log("");

  const result = await mirrorRemoteImages(missing);

  for (const asset of result.stored) {
    console.log(`  mirrored ${asset.byteLength} bytes -> ${asset.storagePath}`);
    mirrorMap[asset.remoteUrl] = asset.storagePath;
    if (!imagePaths.includes(asset.storagePath)) imagePaths.push(asset.storagePath);
  }
  for (const f of result.failedUrls) {
    console.log(`  STILL FAILED: ${f.reason} — ${f.url}`);
  }

  if (result.stored.length === 0) {
    console.log("\nNo images successfully mirrored; leaving row untouched.");
    return;
  }

  if (!WRITE) {
    console.log("\nDry run — pass --write to persist image_urls + image_mirror_map.");
    return;
  }

  const nextMetadata = { ...metadata, image_mirror_map: mirrorMap };
  const { error: updErr } = await admin
    .from("captured_emails")
    .update({ image_urls: imagePaths, metadata: nextMetadata })
    .eq("id", emailId);

  if (updErr) throw updErr;
  console.log(`\nWrote ${result.stored.length} new mirrored asset(s) to ${emailId}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
