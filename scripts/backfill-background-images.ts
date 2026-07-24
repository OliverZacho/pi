/**
 * Backfills CSS/attribute background images for already-captured emails.
 *
 * `extractImageUrlsFromHtml` historically only extracted `<img src>` URLs, so
 * hero sections built as `background:url(...)` (the standard Klaviyo pattern:
 * a background photo behind a transparent spacer `<img>`) were never mirrored.
 * The preview CSP only allows mirrored hosts, so those heroes render as blank
 * blocks. This script re-extracts with the fixed extractor, mirrors the URLs
 * that are missing from `remote_image_urls`, and merges the results into
 * `image_urls`, `remote_image_urls`, `metadata.image_mirror_map` and
 * `metadata.image_stats`.
 *
 * Additive and idempotent: rows whose HTML references no unmirrored
 * background images are skipped, and a second run sees the appended
 * `remote_image_urls` and skips them too.
 *
 *   # dry run (default) — compute + print, write nothing:
 *   npx --yes tsx --conditions=react-server scripts/backfill-background-images.ts
 *   npx --yes tsx --conditions=react-server scripts/backfill-background-images.ts --brand norrona
 *   # actually write:
 *   npx --yes tsx --conditions=react-server scripts/backfill-background-images.ts --write
 *   # options: --write  --limit <n>  --brand <name substring>  --id <email uuid>
 *   # (react-server resolves `server-only` inside lib/supabase-admin.ts)
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
import type { Json } from "../types/supabase";
import { extractImageUrlsFromHtml } from "../lib/email-utils";
import { mirrorRemoteImages } from "../lib/storage";
import {
  buildImageStatsFromSizes,
  parseImageStats
} from "../lib/image-stats";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const brandIdx = args.indexOf("--brand");
const BRAND = brandIdx >= 0 ? args[brandIdx + 1] : null;
const idIdx = args.indexOf("--id");
const ONLY_ID = idIdx >= 0 ? args[idIdx + 1] : null;

const PAGE = 50;

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

  console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN"}\n`);

  let processed = 0;
  let updated = 0;
  let skippedNoMissing = 0;
  let mirrorFailures = 0;
  // Keyset pagination on received_at — a server-side LIKE/regex prefilter on
  // html_content hits the statement timeout, so the precise background-image
  // check runs client-side instead. Microsecond timestamps make the cursor
  // collision-safe in practice.
  let cursor: string | null = null;

  for (;;) {
    if (processed >= LIMIT) break;
    let q = admin
      .from("captured_emails")
      .select(
        "id, subject, company_id, received_at, html_content, image_urls, remote_image_urls, metadata"
      )
      .order("received_at", { ascending: false })
      .limit(PAGE);
    if (ONLY_ID) {
      q = q.eq("id", ONLY_ID);
    }
    if (companyFilter) {
      q = q.in("company_id", companyFilter);
    }
    if (cursor) {
      q = q.lt("received_at", cursor);
    }

    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    cursor = rows[rows.length - 1].received_at;

    for (const row of rows) {
      if (processed >= LIMIT) break;
      processed += 1;

      const html: string = row.html_content ?? "";
      if (!html) continue;

      const existingRemote = new Set<string>(row.remote_image_urls ?? []);
      const missing = Array.from(
        new Set(
          extractImageUrlsFromHtml(html).filter(
            (url) => /^https?:\/\//i.test(url) && !existingRemote.has(url)
          )
        )
      );
      if (missing.length === 0) {
        skippedNoMissing += 1;
        continue;
      }

      console.log(
        `${row.id} "${(row.subject ?? "").slice(0, 60)}" — ${missing.length} unmirrored:`
      );
      for (const url of missing) console.log(`    ${url}`);

      if (!WRITE) continue;

      const mirror = await mirrorRemoteImages(missing);
      for (const failure of mirror.failedUrls) {
        mirrorFailures += 1;
        console.log(`    FAILED ${failure.url}: ${failure.reason}`);
      }
      if (mirror.stored.length === 0) continue;

      const imageUrls: string[] = row.image_urls ?? [];
      const nextImageUrls = [
        ...imageUrls,
        ...mirror.storedPaths.filter((p) => !imageUrls.includes(p))
      ];

      const metadata: Record<string, unknown> =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? { ...(row.metadata as Record<string, unknown>) }
          : {};

      const mirrorMap: Record<string, string> = {
        ...((metadata.image_mirror_map as Record<string, string>) ?? {})
      };
      for (const asset of mirror.stored) {
        mirrorMap[asset.remoteUrl] = asset.storagePath;
      }
      metadata.image_mirror_map = mirrorMap;

      // Merge byte sizes into image_stats so the modal's weight panel and the
      // ≥100KB resize gate see the new assets. Rows without stored stats keep
      // relying on the live storage.objects fallback, so skip them.
      const existingStats = parseImageStats(metadata);
      if (existingStats) {
        const sizesByPath: Record<string, number> = {};
        for (const asset of existingStats.assets) {
          sizesByPath[asset.path] = asset.bytes;
        }
        for (const asset of mirror.stored) {
          sizesByPath[asset.storagePath] = asset.byteLength;
        }
        metadata.image_stats = buildImageStatsFromSizes(
          Object.keys(sizesByPath),
          sizesByPath
        );
      }

      const { error: updateError } = await admin
        .from("captured_emails")
        .update({
          remote_image_urls: [...(row.remote_image_urls ?? []), ...missing],
          image_urls: nextImageUrls,
          metadata: metadata as Json
        })
        .eq("id", row.id);
      if (updateError) {
        console.log(`    UPDATE FAILED: ${updateError.message}`);
        continue;
      }
      updated += 1;
      console.log(`    stored ${mirror.stored.length}, row updated`);
    }

    if (rows.length < PAGE) break;
  }

  console.log(
    `\nDone. processed=${processed} updated=${updated} noMissing=${skippedNoMissing} mirrorFailures=${mirrorFailures}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
