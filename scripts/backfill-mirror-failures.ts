/**
 * Re-mirrors images whose ingest-time mirror attempt failed.
 *
 * `mirrorRemoteImages` runs once per email at ingest; until 2026-08-27 a
 * transient failure (fetch timeout under the ingest burst, Storage
 * "Too many connections" while the uploads race a busy pool) meant the
 * image was never mirrored — and since the preview CSP only allows
 * mirrored hosts, it renders as a broken box in every card and modal
 * forever. The failures are recorded per email in
 * `raw_payload.mirrorFailures`; this script retries them, patches
 * `image_urls` + `metadata.image_mirror_map` + `metadata.image_stats`,
 * and rewrites `mirrorFailures` down to whatever still fails.
 *
 * Idempotent: a second run only sees the URLs that are still listed as
 * failed. URLs that failed with a permanent-looking reason (origin 4xx,
 * oversized image) are skipped by default so the run stays fast; pass
 * --all to retry those too.
 *
 *   # dry run (default) — list what would be retried, write nothing:
 *   npx --yes tsx --conditions=react-server scripts/backfill-mirror-failures.ts
 *   # actually retry + write:
 *   npx --yes tsx --conditions=react-server scripts/backfill-mirror-failures.ts --write
 *   # options: --write  --all  --limit <n>  --id <email uuid>
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
import { mirrorRemoteImages } from "../lib/storage";
import {
  buildImageStatsFromSizes,
  parseImageStats
} from "../lib/image-stats";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const RETRY_ALL = args.includes("--all");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const idIdx = args.indexOf("--id");
const ONLY_ID = idIdx >= 0 ? args[idIdx + 1] : null;

// raw_payload carries the full inbound event, so keep pages small.
const PAGE = 20;

type MirrorFailure = { url: string; reason: string };

/**
 * Failure reasons that won't change on a retry: the origin actively
 * refused (4xx) or the image breaches our size policy. Everything else
 * (timeouts, socket errors, 5xx, 429/499, upload-side errors) is worth
 * another attempt.
 */
function isPermanentReason(reason: string): boolean {
  if (/^image too large/.test(reason)) return true;
  const status = /^http (\d{3})$/.exec(reason)?.[1];
  if (!status) return false;
  const code = Number(status);
  return code >= 400 && code < 500 && code !== 408 && code !== 425 && code !== 429 && code !== 499;
}

function parseFailures(rawPayload: unknown): MirrorFailure[] {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return [];
  }
  const candidate = (rawPayload as Record<string, unknown>).mirrorFailures;
  if (!Array.isArray(candidate)) return [];
  const result: MirrorFailure[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.url === "string" && entry.url) {
      result.push({
        url: entry.url,
        reason: typeof entry.reason === "string" ? entry.reason : "unknown"
      });
    }
  }
  return result;
}

async function main(): Promise<void> {
  const admin = getSupabaseAdmin();

  console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN"}${RETRY_ALL ? " (retrying permanent failures too)" : ""}\n`);

  let processed = 0;
  let updated = 0;
  let recovered = 0;
  let stillFailing = 0;
  let cursor: string | null = null;

  for (;;) {
    if (processed >= LIMIT) break;
    let q = admin
      .from("captured_emails")
      .select("id, subject, received_at, image_urls, metadata, raw_payload")
      .not("raw_payload->mirrorFailures", "is", null)
      .neq("raw_payload->mirrorFailures", "[]")
      .order("received_at", { ascending: false })
      .limit(PAGE);
    if (ONLY_ID) {
      q = q.eq("id", ONLY_ID);
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

      const failures = parseFailures(row.raw_payload);
      if (failures.length === 0) continue;
      processed += 1;

      const retryable = RETRY_ALL
        ? failures
        : failures.filter((f) => !isPermanentReason(f.reason));
      if (retryable.length === 0) continue;

      console.log(
        `${row.id} "${(row.subject ?? "").slice(0, 60)}" — retrying ${retryable.length}/${failures.length}:`
      );
      for (const f of retryable) console.log(`    ${f.url} (${f.reason})`);

      if (!WRITE) continue;

      const mirror = await mirrorRemoteImages(retryable.map((f) => f.url));
      for (const failure of mirror.failedUrls) {
        stillFailing += 1;
        console.log(`    STILL FAILING ${failure.url}: ${failure.reason}`);
      }
      if (mirror.stored.length === 0) continue;
      recovered += mirror.stored.length;

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

      // Merge byte sizes into image_stats so the modal's weight panel and
      // the ≥100KB resize gate see the new assets (same approach as
      // backfill-background-images).
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

      // Shrink mirrorFailures to what still failed, so reruns skip the
      // recovered URLs and the admin record stays truthful.
      const recoveredUrls = new Set(mirror.stored.map((a) => a.remoteUrl));
      const remainingFailures = failures
        .filter((f) => !recoveredUrls.has(f.url))
        .map((f) => {
          const retriedAgain = mirror.failedUrls.find((x) => x.url === f.url);
          return retriedAgain ?? f;
        });
      const rawPayload = {
        ...(row.raw_payload as Record<string, unknown>),
        mirrorFailures: remainingFailures
      };

      const { error: updateError } = await admin
        .from("captured_emails")
        .update({
          image_urls: nextImageUrls,
          metadata: metadata as Json,
          raw_payload: rawPayload as Json
        })
        .eq("id", row.id);
      if (updateError) {
        console.log(`    UPDATE FAILED: ${updateError.message}`);
        continue;
      }
      updated += 1;
      console.log(
        `    recovered ${mirror.stored.length}, ${remainingFailures.length} still listed, row updated`
      );
    }

    if (rows.length < PAGE) break;
  }

  console.log(
    `\nDone. processed=${processed} updated=${updated} recoveredImages=${recovered} stillFailing=${stillFailing}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
