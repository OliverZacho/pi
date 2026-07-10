/**
 * One-off backfill: recompute `captured_emails.has_gif` under the content-GIF
 * definition (a mirrored GIF asset of at least MIN_CONTENT_GIF_BYTES — see
 * detectHasGif in lib/extract-metadata.ts). The old definition counted 1px
 * tracking GIFs, which pushed brands that never animate anything to a 100%
 * "GIF usage" stat on the brand dashboard.
 *
 * Recomputes from `metadata.image_stats`, which is authoritative for asset
 * sizes. Rows without image_stats are left untouched and reported. Only rows
 * whose value actually changes are written, in small id-chunked updates, so
 * the WAL impact stays negligible (see the captured_emails mass-update
 * incident, 2026-07-06).
 *
 *   # dry run (default) — report flips, write nothing:
 *   NODE_OPTIONS="--conditions=react-server" npx --yes tsx scripts/backfill-has-gif.ts
 *   # actually write:
 *   NODE_OPTIONS="--conditions=react-server" npx --yes tsx scripts/backfill-has-gif.ts --write
 *
 * (The react-server condition resolves `server-only` inside
 * lib/supabase-admin to its empty stub instead of the throwing one.)
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
import { MIN_CONTENT_GIF_BYTES } from "../lib/extract-metadata";
import { parseImageStats } from "../lib/image-stats";

const WRITE = process.argv.includes("--write");
// Wide rows: even the slimmed scan takes ~9s for a 500-row page, right at
// the PostgREST statement timeout. 100-row pages run in well under 1s.
const PAGE = 100;
// Rows are wide (large metadata JSONB) and the PostgREST statement timeout
// is short; 100-id chunks hit it in practice, 25 stays comfortably under.
const UPDATE_CHUNK = 25;

async function main(): Promise<void> {
  const admin = getSupabaseAdmin();
  console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN"}`);
  console.log(`Content GIF threshold: ${MIN_CONTENT_GIF_BYTES} bytes\n`);

  const toFalse: string[] = [];
  const toTrue: string[] = [];
  let scanned = 0;
  let noStats = 0;
  let offset = 0;

  for (;;) {
    // Select only the image_stats key — shipping every row's full metadata
    // JSONB is what pushes the scan past the statement timeout.
    const { data, error } = await admin
      .from("captured_emails")
      .select("id, has_gif, image_stats:metadata->image_stats")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      scanned += 1;
      const stats = parseImageStats({ image_stats: row.image_stats });
      if (!stats) {
        noStats += 1;
        continue;
      }
      const next = stats.assets.some(
        (asset) => asset.format === "gif" && asset.bytes >= MIN_CONTENT_GIF_BYTES
      );
      const current = row.has_gif === true;
      if (next === current) continue;
      (next ? toTrue : toFalse).push(row.id);
    }

    offset += data.length;
    if (data.length < PAGE) break;
  }

  console.log(`Scanned ${scanned} emails (${noStats} without image_stats, skipped).`);
  console.log(`Flips true -> false: ${toFalse.length}`);
  console.log(`Flips false -> true: ${toTrue.length}`);

  if (!WRITE) {
    console.log("\nDry run — pass --write to persist.");
    return;
  }

  for (const [value, ids] of [
    [false, toFalse],
    [true, toTrue]
  ] as const) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK);
      const { error } = await admin
        .from("captured_emails")
        .update({ has_gif: value })
        .in("id", chunk);
      if (error) throw error;
      console.log(`  has_gif=${value}: ${Math.min(i + UPDATE_CHUNK, ids.length)}/${ids.length}`);
    }
  }

  console.log(`\nDone. Updated ${toFalse.length + toTrue.length} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
