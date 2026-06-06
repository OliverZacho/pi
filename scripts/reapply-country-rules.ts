/**
 * Re-applies the current country-decision rules to already-classified emails,
 * WITHOUT re-calling the model.
 *
 * The per-email `country_signals` payload already records the model's raw pick
 * (`rawCountry`), the signal it leaned on (`source`), and the real TLD (`tld`).
 * That's everything `resolveDetectedCountry` needs, so after tightening the
 * rules (higher confidence threshold + reject a fabricated `tld` source on
 * generic .com senders) we can recompute `detected_country` deterministically
 * and re-roll-up affected brands. Cheap, instant, and rate-limit-proof.
 *
 * Re-running the model would NOT recover a better answer for the cases this
 * fixes (e.g. brands whose address only exists as a footer *image*) — it would
 * just spend tokens to arrive at the same "unknown". Use the LLM backfill
 * (`backfill-market-country.ts`) only for emails never attempted.
 *
 * Run with:
 *   npx --yes tsx scripts/reapply-country-rules.ts [--dry-run]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveDetectedCountry } from "../lib/classify";
import { recomputeCompanyMarket } from "../lib/market-detect";
import type { Database } from "../types/supabase";

type CountrySignals = {
  language: string | null;
  tld: string | null;
  source:
    | "footer_address"
    | "vat"
    | "phone"
    | "language"
    | "tld"
    | "mixed"
    | "none";
  rawCountry: string | null;
};

type Row = {
  id: string;
  company_id: string | null;
  detected_country: string | null;
  country_confidence: number | string | null;
  country_signals: CountrySignals | null;
};

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
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function toNumber(value: number | string | null): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const dryRun = process.argv.includes("--dry-run");
  const supabase = buildAdminClient();

  const { data, error } = await supabase
    .from("captured_emails")
    .select("id, company_id, detected_country, country_confidence, country_signals")
    .not("country_signals", "is", null);

  if (error) {
    console.error("Failed to load captured_emails:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(`Re-applying country rules to ${rows.length} classified email(s) | dry-run=${dryRun}`);

  let changed = 0;
  const affectedCompanies = new Set<string>();
  const transitions: Record<string, number> = {};

  for (const row of rows) {
    const sig = row.country_signals;
    const next = resolveDetectedCountry({
      rawCountry: sig?.rawCountry ?? null,
      confidence: toNumber(row.country_confidence),
      source: sig?.source ?? "none",
      tld: sig?.tld ?? null
    });

    if (next === row.detected_country) continue;

    changed += 1;
    const key = `${row.detected_country ?? "unknown"} -> ${next ?? "unknown"}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
    if (row.company_id) affectedCompanies.add(row.company_id);

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from("captured_emails")
        .update({ detected_country: next })
        .eq("id", row.id);
      if (updateError) {
        console.error(`  update failed for ${row.id}: ${updateError.message}`);
      }
    }
  }

  console.log(`\nEmails changed: ${changed}`);
  for (const [key, n] of Object.entries(transitions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${key}`);
  }

  if (dryRun) {
    console.log("\nDry run — no rows or brand rollups were modified.");
    return;
  }

  console.log(`\nRe-rolling up ${affectedCompanies.size} affected brand(s)…`);
  const marketTally: Record<string, number> = {};
  for (const companyId of affectedCompanies) {
    try {
      const rollup = await recomputeCompanyMarket(companyId);
      const k = rollup.country ?? "unknown";
      marketTally[k] = (marketTally[k] ?? 0) + 1;
    } catch (e) {
      console.error(
        `  rollup failed for ${companyId}: ${e instanceof Error ? e.message : "unknown"}`
      );
    }
  }

  console.log("\nNew primary market for affected brands");
  for (const [country, n] of Object.entries(marketTally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${country}`);
  }
}

main().catch((error) => {
  console.error("Re-apply crashed:", error);
  process.exit(1);
});
