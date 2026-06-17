/**
 * Re-runs ESP detection over captured_email rows whose sender_email or
 * html_content matches a given ILIKE pattern. Useful after adding a new ESP
 * fingerprint to reclassify just that ESP's history without touching unrelated
 * rows.
 *
 *   npx --yes tsx scripts/backfill-esp-sender.ts --sender-like=%hm.com [--dry-run]
 *   npx --yes tsx scripts/backfill-esp-sender.ts --html-like=%cdn.braze.eu% [--dry-run]
 *
 * --sender-like and --html-like can both be given; rows matching EITHER are
 * processed. At least one is required.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { detectEsp } from "../lib/esp-detect";
import { extractMetadata } from "../lib/extract-metadata";
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

function extractHeaders(raw: Json | null): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const full = (raw as Record<string, unknown>).full;
  if (!full || typeof full !== "object" || Array.isArray(full)) return null;
  const headers = (full as Record<string, unknown>).headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const dryRun = process.argv.includes("--dry-run");
  const senderArg = process.argv.find((a) => a.startsWith("--sender-like="));
  const htmlArg = process.argv.find((a) => a.startsWith("--html-like="));
  const senderLike = senderArg ? senderArg.slice("--sender-like=".length) : "";
  const htmlLike = htmlArg ? htmlArg.slice("--html-like=".length) : "";
  if (!senderLike && !htmlLike) {
    console.error(
      "Missing --sender-like=<pattern> or --html-like=<pattern>. Example: --html-like=%cdn.braze.eu%"
    );
    process.exit(1);
  }
  const supabase = buildAdminClient();

  let query = supabase
    .from("captured_emails")
    .select(
      "id, sender_email, subject, html_content, plain_text, esp_provider, esp_confidence, raw_payload, metadata"
    );

  if (senderLike && htmlLike) {
    query = query.or(
      `sender_email.ilike.${senderLike},html_content.ilike.${htmlLike}`
    );
  } else if (senderLike) {
    query = query.ilike("sender_email", senderLike);
  } else {
    query = query.ilike("html_content", htmlLike);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load rows:", error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  console.log(
    `ESP backfill: ${rows.length} row(s) | sender-like=${senderLike || "-"} | html-like=${htmlLike || "-"} | dry-run=${dryRun}`
  );

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    const html = row.html_content ?? "";
    const headers = extractHeaders(row.raw_payload);
    const metadata = extractMetadata({
      subject: row.subject ?? "",
      html,
      plainText: row.plain_text ?? undefined,
      mirroredAssets: [],
      headers
    });
    const result = detectEsp({
      headers,
      html,
      links: metadata.links,
      resourceHosts: metadata.resource_hosts
    });

    const beforeProvider = row.esp_provider ?? null;
    const beforeConfidence =
      row.esp_confidence === null || row.esp_confidence === undefined
        ? 0
        : Number(row.esp_confidence);
    const nextProvider = result.provider === "unknown" ? null : result.provider;
    const providerChanged = beforeProvider !== nextProvider;
    const confidenceChanged =
      Math.abs(beforeConfidence - result.confidence) > 0.0005;

    if (!providerChanged && !confidenceChanged) {
      unchanged += 1;
      console.log(
        `  ${row.id} (${row.sender_email}) ${beforeProvider ?? "null"} (${beforeConfidence.toFixed(2)}) — unchanged`
      );
      continue;
    }

    console.log(
      `  ${row.id} (${row.sender_email}) ${beforeProvider ?? "null"} (${beforeConfidence.toFixed(2)}) -> ${result.provider} (${result.confidence.toFixed(2)})`
    );

    if (dryRun) {
      updated += 1;
      continue;
    }

    const existingMetadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const nextMetadata = {
      ...existingMetadata,
      esp_candidates: result.candidates
    } as Json;

    const { error: updateError } = await supabase
      .from("captured_emails")
      .update({
        esp_provider: nextProvider,
        esp_confidence: result.confidence,
        esp_signals: result.signals as unknown as Json,
        metadata: nextMetadata
      })
      .eq("id", row.id);

    if (updateError) {
      failed += 1;
      console.error(`    FAILED: ${updateError.message}`);
    } else {
      updated += 1;
    }
  }

  console.log(`\nSummary: updated=${updated} unchanged=${unchanged} failed=${failed}`);
  if (dryRun) console.log("Dry run — no rows were modified.");
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("H&M ESP backfill crashed:", error);
  process.exit(1);
});
