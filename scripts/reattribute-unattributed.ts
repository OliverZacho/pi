/**
 * One-time re-attribution of the existing unattributed-email backlog.
 *
 * Attribution is normally decided once, at insert time, by matching an inbound
 * email's recipient address against `company_inboxes.email_address`. Mail that
 * arrived before its brand was registered (the classic CSV-uploader race: you
 * subscribe, the welcome lands, and only then do you add the brand) is stored
 * with `company_id IS NULL` and never revisited. Going forward,
 * `claimUnattributedEmailsForInbox` (lib/admin-db.ts) fixes this automatically
 * at inbox-creation time; this script cleans up the rows that predate that.
 *
 * It re-runs the exact same matching key — `recipient_email == inbox address`
 * — against every currently-unattributed row and, for each match, assigns the
 * owning brand + inbox (and denormalises that inbox's segment). Classification
 * is left untouched.
 *
 * SAFETY — this bucket is not homogeneous, so the script is conservative:
 *   - Only rows with `company_id IS NULL` are ever touched.
 *   - A recipient is only claimed when it *exactly* equals a live
 *     `company_inboxes.email_address`. Addresses no brand owns are left alone.
 *   - Registered signup-probe addresses are excluded — probe mail also lives in
 *     the unattributed bucket and must never be filed under a brand.
 *   - Emails a human deliberately blanked to `company_id = NULL` leave NO
 *     schema signal, so they can't be auto-distinguished. That's why this runs
 *     as a DRY RUN by default: review the per-brand preview and use
 *     --address / --company to narrow (or skip) anything that shouldn't move
 *     before re-running with --apply.
 *
 * Run with:
 *   npx --yes tsx --conditions=react-server scripts/reattribute-unattributed.ts
 *   npx --yes tsx --conditions=react-server scripts/reattribute-unattributed.ts --apply
 *
 * Flags:
 *   --apply            Actually write. Without it, nothing is changed.
 *   --company=<id>     Only claim mail for brand <id>. Repeatable.
 *   --address=<addr>   Only claim mail sent to <addr>. Repeatable.
 *   --samples=<n>      Sample subject lines to print per brand (default 3).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";

type CliOptions = {
  apply: boolean;
  onlyCompanies: Set<string> | null;
  onlyAddresses: Set<string> | null;
  samples: number;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    apply: false,
    onlyCompanies: null,
    onlyAddresses: null,
    samples: 3
  };
  for (const raw of argv) {
    if (raw === "--apply") {
      opts.apply = true;
    } else if (raw.startsWith("--company=")) {
      const value = raw.slice("--company=".length).trim();
      if (value) (opts.onlyCompanies ??= new Set()).add(value);
    } else if (raw.startsWith("--address=")) {
      const value = raw.slice("--address=".length).trim().toLowerCase();
      if (value) (opts.onlyAddresses ??= new Set()).add(value);
    } else if (raw.startsWith("--samples=")) {
      const value = Number.parseInt(raw.slice("--samples=".length), 10);
      if (Number.isFinite(value) && value >= 0) opts.samples = value;
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

type Inbox = {
  id: string;
  company_id: string;
  email_address: string;
  segment_category: string | null;
  segment_country: string | null;
};

type UnattributedRow = {
  id: string;
  recipient_email: string;
  subject: string | null;
  sent_at: string | null;
};

async function loadInboxes(
  supabase: SupabaseClient<Database>
): Promise<Map<string, Inbox>> {
  const byAddress = new Map<string, Inbox>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("company_inboxes")
      .select("id, company_id, email_address, segment_category, segment_country")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      byAddress.set(row.email_address.trim().toLowerCase(), row as Inbox);
    }
    if (data.length < pageSize) break;
  }
  return byAddress;
}

async function loadProbeAddresses(
  supabase: SupabaseClient<Database>
): Promise<Set<string>> {
  const addresses = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("signup_probes")
      .select("address")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) addresses.add(row.address.trim().toLowerCase());
    if (data.length < pageSize) break;
  }
  return addresses;
}

async function loadUnattributed(
  supabase: SupabaseClient<Database>
): Promise<UnattributedRow[]> {
  const rows: UnattributedRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("captured_emails")
      .select("id, recipient_email, subject, sent_at")
      .is("company_id", null)
      .order("sent_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as UnattributedRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const supabase = buildAdminClient();

  const [inboxes, probes, unattributed] = await Promise.all([
    loadInboxes(supabase),
    loadProbeAddresses(supabase),
    loadUnattributed(supabase)
  ]);

  console.log(
    `Loaded ${inboxes.size} inbox addresses, ${probes.size} probe addresses, ` +
      `${unattributed.length} unattributed emails.\n`
  );

  // Group claimable rows by the address (== inbox) they'll be filed under.
  type Group = { inbox: Inbox; rows: UnattributedRow[] };
  const groups = new Map<string, Group>();
  let skippedProbe = 0;
  let noOwner = 0;

  for (const row of unattributed) {
    const recipient = (row.recipient_email ?? "").trim().toLowerCase();
    if (!recipient) {
      noOwner++;
      continue;
    }
    if (probes.has(recipient)) {
      skippedProbe++;
      continue;
    }
    const inbox = inboxes.get(recipient);
    if (!inbox) {
      noOwner++;
      continue;
    }
    if (opts.onlyCompanies && !opts.onlyCompanies.has(inbox.company_id)) continue;
    if (opts.onlyAddresses && !opts.onlyAddresses.has(recipient)) continue;
    const group = groups.get(recipient) ?? { inbox, rows: [] };
    group.rows.push(row);
    groups.set(recipient, group);
  }

  const totalClaimable = [...groups.values()].reduce(
    (sum, g) => sum + g.rows.length,
    0
  );

  console.log(
    `Would claim ${totalClaimable} email(s) across ${groups.size} brand inbox(es).`
  );
  console.log(`Skipped as signup probes: ${skippedProbe}.`);
  console.log(`Left unattributed (no owning inbox / blank recipient): ${noOwner}.\n`);

  const sortedGroups = [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length
  );
  for (const group of sortedGroups) {
    console.log(
      `  ${group.inbox.email_address}  (company ${group.inbox.company_id}) — ${group.rows.length} email(s)`
    );
    for (const row of group.rows.slice(0, opts.samples)) {
      const when = row.sent_at ? row.sent_at.slice(0, 10) : "????-??-??";
      const subject = (row.subject ?? "(no subject)").slice(0, 70);
      console.log(`      ${when}  ${subject}`);
    }
    if (group.rows.length > opts.samples) {
      console.log(`      … and ${group.rows.length - opts.samples} more`);
    }
  }
  console.log("");

  if (!opts.apply) {
    console.log("DRY RUN — nothing written. Re-run with --apply to commit.");
    return;
  }

  let written = 0;
  for (const group of sortedGroups) {
    const { inbox } = group;
    // Re-assert company_id IS NULL in the write so we never overwrite a row
    // that got attributed between the read and the write.
    const { data, error } = await supabase
      .from("captured_emails")
      .update({
        company_id: inbox.company_id,
        inbox_id: inbox.id,
        segment_category: inbox.segment_category,
        segment_country: inbox.segment_country
      })
      .is("company_id", null)
      .eq("recipient_email", inbox.email_address.trim().toLowerCase())
      .select("id");
    if (error) {
      console.error(`  FAILED ${inbox.email_address}: ${error.message}`);
      continue;
    }
    const count = data?.length ?? 0;
    written += count;
    console.log(`  claimed ${count} for ${inbox.email_address}`);
  }

  console.log(`\nDone. Re-attributed ${written} email(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
