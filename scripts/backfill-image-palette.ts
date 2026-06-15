/**
 * Backfills `captured_emails.metadata.image_palette` — the pixel-extracted brand
 * palette — for emails ingested before the image-palette stage existed.
 *
 * Additive and reversible: it only sets the NEW `image_palette` field; the
 * HTML-token `palette_colors` is left untouched, and `computeDesign` /
 * `parsePaletteColors` fall back to it whenever `image_palette` is absent or
 * empty. Clearing `image_palette` reverts to the old behaviour.
 *
 *   # dry run (default) — compute + print, write nothing:
 *   npx --yes tsx scripts/backfill-image-palette.ts
 *   npx --yes tsx scripts/backfill-image-palette.ts --brand ferm
 *   # actually write:
 *   npx --yes tsx scripts/backfill-image-palette.ts --write
 *   # options: --write  --force  --limit <n>  --brand <name substring>
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
import { extractImagePaletteForEmail } from "../lib/extract-image-palette";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const FORCE = args.includes("--force");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const brandIdx = args.indexOf("--brand");
const BRAND = brandIdx >= 0 ? args[brandIdx + 1] : null;

const PAGE = 100;

async function main(): Promise<void> {
  const admin = getSupabaseAdmin();

  let companyFilter: string[] | null = null;
  if (BRAND) {
    const { data } = await admin
      .from("companies")
      .select("id, name")
      .ilike("name", `%${BRAND}%`);
    companyFilter = (data ?? []).map((c) => c.id);
    console.log(
      `Brand filter "${BRAND}" → ${companyFilter.length} companies: ${(data ?? [])
        .map((c) => c.name)
        .join(", ")}`
    );
    if (companyFilter.length === 0) return;
  }

  console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN"}${FORCE ? " · force" : ""}\n`);

  let processed = 0;
  let updated = 0;
  let skippedHasPalette = 0;
  let skippedNoColours = 0;
  let from = 0;

  for (;;) {
    if (processed >= LIMIT) break;
    let q = admin
      .from("captured_emails")
      .select("id, company_id, image_urls, metadata")
      .is("duplicate_of", null)
      .order("received_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (companyFilter) q = q.in("company_id", companyFilter);

    const { data: rows, error } = await q;
    if (error) {
      console.error("query failed:", error.message);
      break;
    }
    if (!rows || rows.length === 0) break;
    from += rows.length;

    for (const row of rows) {
      if (processed >= LIMIT) break;
      processed++;

      const meta =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const existing = meta.image_palette;
      if (!FORCE && Array.isArray(existing) && existing.length > 0) {
        skippedHasPalette++;
        continue;
      }

      const paths = Array.isArray(row.image_urls) ? (row.image_urls as string[]) : [];
      const palette = await extractImagePaletteForEmail(paths);

      if (palette.length === 0) {
        skippedNoColours++;
        continue;
      }

      const hexes = palette.map((p) => p.hex).join(" ");
      console.log(`  ${row.id}  ${hexes}`);

      if (WRITE) {
        const nextMeta = { ...meta, image_palette: palette };
        const { error: upErr } = await admin
          .from("captured_emails")
          .update({ metadata: nextMeta })
          .eq("id", row.id);
        if (upErr) {
          console.error(`    update failed for ${row.id}:`, upErr.message);
          continue;
        }
      }
      updated++;
    }
  }

  console.log(
    `\nDone. processed=${processed} ${WRITE ? "updated" : "would-update"}=${updated} ` +
      `skipped(has-palette)=${skippedHasPalette} skipped(no-colours)=${skippedNoColours}`
  );
  if (!WRITE) console.log("Dry run — re-run with --write to persist.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
