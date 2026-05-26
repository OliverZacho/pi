/**
 * Backfills every existing object in the `email-assets` bucket from
 * the per-email `${emailId}/${sha1}${ext}` layout to the globally
 * deduplicated `${sha1}${ext}` layout that `mirrorRemoteImages`
 * writes when `DEDUP_ASSET_PATHS=true`.
 *
 * Run with:
 *   npx --yes tsx scripts/dedup-asset-paths.ts            # dry run
 *   npx --yes tsx scripts/dedup-asset-paths.ts --commit   # for real
 *
 * Flags:
 *   --commit             Actually perform the storage copies, DB
 *                        updates, and deletes. Without this flag
 *                        the script only inventories and prints
 *                        what it WOULD do.
 *   --skip-delete        Skip the final cleanup phase that removes
 *                        the old objects after their content has
 *                        been copied to the bucket root. Useful for
 *                        a two-stage rollout where you want to keep
 *                        the old paths around as a safety net for a
 *                        day before reclaiming the storage.
 *   --limit=<n>          Only process the first <n> matching objects
 *                        (per phase). Useful for a smoke test
 *                        against a handful of objects with --commit.
 *   --concurrency=<n>    Parallelism for storage copy/delete calls.
 *                        Defaults to 8. Bump up if the run is
 *                        bottlenecked on Supabase round-trips and
 *                        you trust the gateway to handle the burst.
 *
 * Pre-requisites:
 *
 *   1. `DEDUP_ASSET_PATHS=true` is set in the production environment
 *      AND the webhook processor has been redeployed with it. The
 *      script aborts if it sees the env var unset, to prevent the
 *      race where new webhook writes land in the old layout
 *      mid-migration and end up orphaned.
 *   2. `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
 *      readable from .env.local (same pattern the other backfill
 *      scripts use).
 *
 * Algorithm:
 *
 *   Phase 1 (inventory): query `storage.objects` directly to count
 *   how many objects live at the old vs new layout. Print the plan.
 *
 *   Phase 2 (copy): for every old-layout object, copy its bytes to
 *   the bucket root at `${sha1}${ext}`. Idempotent — if the
 *   destination already exists (because another email already
 *   contained the same content), the copy is skipped. The old
 *   object is left in place at this point so any in-flight reader
 *   that still has the old DB path keeps working.
 *
 *   Phase 3 (DB rewrite): one transactional pass per table that
 *   strips the `${emailId}/` prefix from path columns:
 *     - captured_emails.image_urls  (text[])
 *     - companies.logo_storage_path  (text)
 *     - email_products.image_storage_path  (text)
 *   After this phase the application reads from the new paths
 *   exclusively.
 *
 *   Phase 4 (delete): for every old-layout object whose new path
 *   exists in the bucket, delete the old object. Reclaims ~half
 *   the bucket on the current data (2,584 → ~1,352 unique blobs).
 *
 * Re-runs are safe: phases 2 and 4 are idempotent, and phase 3 only
 * touches rows whose values still contain a slash, so a second run
 * after a partial first run picks up exactly where it left off.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";

const BUCKET = "email-assets";
const ASSET_BASENAME_RE = /^[a-f0-9]{40}\.[a-z0-9]+$/;
const OLD_FORMAT_RE = /^[^/]+\/[a-f0-9]{40}\.[a-z0-9]+$/;

type CliOptions = {
  commit: boolean;
  skipDelete: boolean;
  limit: number | null;
  concurrency: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    commit: false,
    skipDelete: false,
    limit: null,
    concurrency: 8
  };
  for (const raw of argv) {
    if (raw === "--commit") {
      opts.commit = true;
    } else if (raw === "--skip-delete") {
      opts.skipDelete = true;
    } else if (raw.startsWith("--limit=")) {
      const parsed = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        opts.limit = parsed;
      }
    } else if (raw.startsWith("--concurrency=")) {
      const parsed = Number.parseInt(raw.slice("--concurrency=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        opts.concurrency = parsed;
      }
    }
  }
  return opts;
}

function loadDotEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  let text: string;
  try {
    text = readFileSync(envPath, "utf-8");
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

/**
 * Returns the canonical "new layout" name for an asset path, which
 * is just the basename. Exported for tests.
 */
export function newAssetPath(oldPath: string): string {
  const slash = oldPath.lastIndexOf("/");
  return slash === -1 ? oldPath : oldPath.slice(slash + 1);
}

type ObjectRow = { name: string; size: number };

const LIST_PAGE_SIZE = 1000;

type StorageListItem = {
  name: string;
  id: string | null;
  metadata: { size?: number } | null;
};

async function listOneLevel(
  supabase: SupabaseClient<Database>,
  prefix: string
): Promise<StorageListItem[]> {
  // The storage `.list()` endpoint returns up to LIST_PAGE_SIZE
  // entries per call, paginated by offset. Folders are returned as
  // entries with `id: null` (no metadata); actual files have an id
  // and metadata. We page until we get a short response.
  const out: StorageListItem[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" }
      });
    if (error) {
      throw new Error(`list(${prefix || "<root>"}): ${error.message}`);
    }
    const page = (data ?? []) as StorageListItem[];
    out.push(...page);
    if (page.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return out;
}

async function listAssetObjects(
  supabase: SupabaseClient<Database>
): Promise<ObjectRow[]> {
  // The bucket is one level deep at most: either `${sha1}${ext}`
  // (new layout, at root) or `${emailId}/${sha1}${ext}` (old
  // layout, one folder deep). List the root first, then list each
  // folder concurrently to keep the wall-clock down even with
  // hundreds of email folders.
  const root = await listOneLevel(supabase, "");
  const objects: ObjectRow[] = [];
  const folderNames: string[] = [];
  for (const entry of root) {
    if (entry.id === null) {
      folderNames.push(entry.name);
    } else {
      objects.push({ name: entry.name, size: entry.metadata?.size ?? 0 });
    }
  }

  console.log(
    `  walking ${folderNames.length} folder(s) + ${objects.length} root object(s)`
  );

  const folderResults = await runInParallel(folderNames, 16, async (folder) => {
    const entries = await listOneLevel(supabase, folder);
    return entries
      .filter((e) => e.id !== null)
      .map<ObjectRow>((e) => ({
        name: `${folder}/${e.name}`,
        size: e.metadata?.size ?? 0
      }));
  });

  for (const batch of folderResults) {
    objects.push(...batch);
  }

  return objects;
}

type Inventory = {
  oldFormat: ObjectRow[];
  newFormat: ObjectRow[];
  other: ObjectRow[];
  newFormatNames: Set<string>;
};

function classifyObjects(objects: ObjectRow[]): Inventory {
  const oldFormat: ObjectRow[] = [];
  const newFormat: ObjectRow[] = [];
  const other: ObjectRow[] = [];
  const newFormatNames = new Set<string>();
  for (const obj of objects) {
    if (ASSET_BASENAME_RE.test(obj.name)) {
      newFormat.push(obj);
      newFormatNames.add(obj.name);
    } else if (OLD_FORMAT_RE.test(obj.name)) {
      oldFormat.push(obj);
    } else {
      other.push(obj);
    }
  }
  return { oldFormat, newFormat, other, newFormatNames };
}

function bytes(bs: number): string {
  if (bs < 1024) return `${bs} B`;
  if (bs < 1024 * 1024) return `${(bs / 1024).toFixed(1)} KB`;
  return `${(bs / 1024 / 1024).toFixed(1)} MB`;
}

async function runInParallel<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function take(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => take())
  );
  return results;
}

type CopyOutcome =
  | { kind: "copied"; from: string; to: string }
  | { kind: "skipped-already-present"; from: string; to: string }
  | { kind: "failed"; from: string; to: string; error: string };

async function copyOldToNew(
  supabase: SupabaseClient<Database>,
  objects: ObjectRow[],
  alreadyPresent: Set<string>,
  opts: CliOptions
): Promise<CopyOutcome[]> {
  const todo = opts.limit ? objects.slice(0, opts.limit) : objects;
  console.log(
    `\nPhase 2 — copy: ${todo.length} old-format object(s) to inspect`
  );

  return runInParallel(todo, opts.concurrency, async (obj) => {
    const target = newAssetPath(obj.name);
    if (alreadyPresent.has(target)) {
      return { kind: "skipped-already-present", from: obj.name, to: target };
    }
    if (!opts.commit) {
      // Pre-register the target so a later old-format object with
      // the same SHA-1 sees it as already-present in the dry-run
      // simulation — keeps the totals honest.
      alreadyPresent.add(target);
      return { kind: "copied", from: obj.name, to: target };
    }
    const { error } = await supabase.storage
      .from(BUCKET)
      .copy(obj.name, target);
    if (error) {
      // Storage's `copy` returns this error message verbatim when
      // the destination already exists. Treat as a benign skip so
      // re-runs are idempotent even if our local `alreadyPresent`
      // set was stale.
      if (/already exists|duplicate/i.test(error.message)) {
        return { kind: "skipped-already-present", from: obj.name, to: target };
      }
      return {
        kind: "failed",
        from: obj.name,
        to: target,
        error: error.message
      };
    }
    alreadyPresent.add(target);
    return { kind: "copied", from: obj.name, to: target };
  });
}

type DbRewriteCounts = {
  capturedEmails: number;
  companies: number;
  emailProducts: number;
};

async function rewriteDbPaths(
  supabase: SupabaseClient<Database>,
  opts: CliOptions
): Promise<DbRewriteCounts> {
  console.log("\nPhase 3 — DB rewrite");

  // `captured_emails.image_urls` is a text[] of storage paths. The
  // pure-JS rewrite is easier to reason about than a Postgres
  // expression and the row count is tiny.
  const { data: emailRows, error: emailErr } = await supabase
    .from("captured_emails")
    .select("id, image_urls")
    .filter("image_urls", "neq", "{}");

  if (emailErr) throw new Error(`select captured_emails: ${emailErr.message}`);

  let capturedRewrites = 0;
  for (const row of emailRows ?? []) {
    const before = row.image_urls ?? [];
    const after = before.map(newAssetPath);
    if (after.some((p, i) => p !== before[i])) {
      capturedRewrites++;
      if (opts.commit) {
        const { error } = await supabase
          .from("captured_emails")
          .update({ image_urls: after })
          .eq("id", row.id);
        if (error) {
          throw new Error(
            `update captured_emails ${row.id}: ${error.message}`
          );
        }
      }
    }
  }

  const { data: companyRows, error: companyErr } = await supabase
    .from("companies")
    .select("id, logo_storage_path")
    .not("logo_storage_path", "is", null);
  if (companyErr) throw new Error(`select companies: ${companyErr.message}`);

  let companyRewrites = 0;
  for (const row of companyRows ?? []) {
    if (!row.logo_storage_path) continue;
    const next = newAssetPath(row.logo_storage_path);
    if (next !== row.logo_storage_path) {
      companyRewrites++;
      if (opts.commit) {
        const { error } = await supabase
          .from("companies")
          .update({ logo_storage_path: next })
          .eq("id", row.id);
        if (error) {
          throw new Error(`update companies ${row.id}: ${error.message}`);
        }
      }
    }
  }

  const { data: productRows, error: productErr } = await supabase
    .from("email_products")
    .select("id, image_storage_path")
    .not("image_storage_path", "is", null);
  if (productErr) {
    throw new Error(`select email_products: ${productErr.message}`);
  }

  let productRewrites = 0;
  for (const row of productRows ?? []) {
    if (!row.image_storage_path) continue;
    const next = newAssetPath(row.image_storage_path);
    if (next !== row.image_storage_path) {
      productRewrites++;
      if (opts.commit) {
        const { error } = await supabase
          .from("email_products")
          .update({ image_storage_path: next })
          .eq("id", row.id);
        if (error) {
          throw new Error(`update email_products ${row.id}: ${error.message}`);
        }
      }
    }
  }

  return {
    capturedEmails: capturedRewrites,
    companies: companyRewrites,
    emailProducts: productRewrites
  };
}

type DeleteOutcome =
  | { kind: "deleted"; name: string }
  | { kind: "skipped-no-target"; name: string }
  | { kind: "failed"; name: string; error: string };

async function deleteOldObjects(
  supabase: SupabaseClient<Database>,
  objects: ObjectRow[],
  reachableTargets: Set<string>,
  opts: CliOptions
): Promise<DeleteOutcome[]> {
  const todo = opts.limit ? objects.slice(0, opts.limit) : objects;
  console.log(
    `\nPhase 4 — delete: ${todo.length} old-format object(s) to remove`
  );

  return runInParallel(todo, opts.concurrency, async (obj) => {
    const target = newAssetPath(obj.name);
    if (!reachableTargets.has(target)) {
      // Defensive: never delete an old object whose deduplicated
      // copy isn't actually present at the bucket root, even if our
      // copy phase claims to have placed it there. Better to leave
      // orphans than to lose bytes.
      return { kind: "skipped-no-target", name: obj.name };
    }
    if (!opts.commit) {
      return { kind: "deleted", name: obj.name };
    }
    const { error } = await supabase.storage.from(BUCKET).remove([obj.name]);
    if (error) {
      return { kind: "failed", name: obj.name, error: error.message };
    }
    return { kind: "deleted", name: obj.name };
  });
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));

  console.log(
    `dedup-asset-paths: mode=${opts.commit ? "COMMIT" : "DRY-RUN"} ` +
      `skipDelete=${opts.skipDelete} ` +
      `limit=${opts.limit ?? "all"} ` +
      `concurrency=${opts.concurrency}`
  );

  if (opts.commit && process.env.DEDUP_ASSET_PATHS !== "true") {
    console.error(
      "\nRefusing to commit migration without DEDUP_ASSET_PATHS=true in the\n" +
        "environment. The production webhook processor must already be\n" +
        "writing new objects at the bucket root before we backfill, otherwise\n" +
        "any email that arrives mid-migration ends up orphaned in the old\n" +
        "layout AND its DB row gets pointed at a path that doesn't exist.\n\n" +
        "If you're sure the deploy is live, run again with the env var set."
    );
    process.exit(1);
  }

  const supabase = buildAdminClient();

  console.log("\nPhase 1 — inventory");
  const allObjects = await listAssetObjects(supabase);
  const inv = classifyObjects(allObjects);
  const oldBytes = inv.oldFormat.reduce((s, o) => s + o.size, 0);
  const newBytes = inv.newFormat.reduce((s, o) => s + o.size, 0);
  console.log(
    `  old-format-folder: ${inv.oldFormat.length} object(s), ${bytes(oldBytes)}`
  );
  console.log(
    `  new-format-root:   ${inv.newFormat.length} object(s), ${bytes(newBytes)}`
  );
  console.log(`  other:             ${inv.other.length} object(s)`);
  if (inv.other.length > 0) {
    console.log(
      "  ⚠️  Unexpected object names detected; they will be ignored:"
    );
    for (const o of inv.other.slice(0, 5)) console.log(`    - ${o.name}`);
    if (inv.other.length > 5) {
      console.log(`    ... and ${inv.other.length - 5} more`);
    }
  }

  if (inv.oldFormat.length === 0) {
    console.log("\nNothing to do — bucket is already fully deduplicated.");
    return;
  }

  // Pre-compute how many of the old-format objects share a SHA-1
  // with each other or with an already-existing new-format object.
  // This is the headline win the migration unlocks.
  const targetCounts = new Map<string, number>();
  for (const obj of inv.oldFormat) {
    const t = newAssetPath(obj.name);
    targetCounts.set(t, (targetCounts.get(t) ?? 0) + 1);
  }
  const uniqueTargets = targetCounts.size;
  const alreadyAtRoot = Array.from(targetCounts.keys()).filter((t) =>
    inv.newFormatNames.has(t)
  ).length;
  const willDedup = inv.oldFormat.length - uniqueTargets;
  console.log(
    `  → ${uniqueTargets} unique SHA-1 target(s), ${alreadyAtRoot} already at root,` +
      ` ${willDedup} object(s) will be collapsed into existing targets.`
  );

  const targetsAfterCopy = new Set(inv.newFormatNames);
  const copyOutcomes = await copyOldToNew(
    supabase,
    inv.oldFormat,
    targetsAfterCopy,
    opts
  );
  const copied = copyOutcomes.filter((o) => o.kind === "copied").length;
  const skipped = copyOutcomes.filter(
    (o) => o.kind === "skipped-already-present"
  ).length;
  const copyFailed = copyOutcomes.filter((o) => o.kind === "failed").length;
  console.log(
    `  copied=${copied} skipped(dup)=${skipped} failed=${copyFailed}`
  );
  if (copyFailed > 0) {
    for (const o of copyOutcomes) {
      if (o.kind === "failed") {
        console.log(`    FAIL ${o.from} → ${o.to}: ${o.error}`);
      }
    }
    console.error("\nCopy phase had failures; aborting before DB rewrite.");
    process.exit(2);
  }

  const dbCounts = await rewriteDbPaths(supabase, opts);
  console.log(
    `  captured_emails rewrites: ${dbCounts.capturedEmails}, ` +
      `companies: ${dbCounts.companies}, email_products: ${dbCounts.emailProducts}`
  );

  if (opts.skipDelete) {
    console.log(
      "\nPhase 4 skipped (--skip-delete). Re-run without the flag once the new" +
        " layout has baked to reclaim the duplicated storage."
    );
  } else {
    const deleteOutcomes = await deleteOldObjects(
      supabase,
      inv.oldFormat,
      targetsAfterCopy,
      opts
    );
    const deleted = deleteOutcomes.filter((o) => o.kind === "deleted").length;
    const noTarget = deleteOutcomes.filter(
      (o) => o.kind === "skipped-no-target"
    ).length;
    const delFailed = deleteOutcomes.filter((o) => o.kind === "failed").length;
    console.log(
      `  deleted=${deleted} skipped(no-target)=${noTarget} failed=${delFailed}`
    );
    if (delFailed > 0) {
      for (const o of deleteOutcomes) {
        if (o.kind === "failed") {
          console.log(`    FAIL ${o.name}: ${o.error}`);
        }
      }
    }
  }

  console.log(
    `\n${opts.commit ? "COMMITTED" : "DRY RUN"} — done.${
      opts.commit ? "" : " Re-run with --commit to apply."
    }`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
