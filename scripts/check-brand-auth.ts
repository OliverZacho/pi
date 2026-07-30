/**
 * Sweep every brand's email authentication posture (DMARC / BIMI / VMC) from
 * public DNS and record it in `brand_auth_status`.
 *
 * WHY — BIMI (Brand Indicators for Message Identification) lets a brand publish
 * its logo in a TXT record at `default._bimi.<domain>`, and a VMC/CMC cert (the
 * `a=` tag) is a CA-verified trademark that earns the "verified sender" mark in
 * Gmail/Apple Mail. BIMI only renders when DMARC is at enforcement
 * (p=quarantine or p=reject), so we capture all three together. Adoption is a
 * useful trust signal and a point of differentiation between brands.
 *
 * WHICH DOMAIN — BIMI is evaluated against the *From-header* domain, which for
 * marketing mail is nearly always a subdomain (e.g. "e.arket.com"). But the
 * BIMI/DMARC records themselves usually live on the organisational domain
 * ("arket.com"). We therefore evaluate each brand's *dominant* sender domain
 * (the most common From domain in its captured mail) and walk upward one label
 * at a time, taking the first level that publishes a record -- exactly the order
 * a mail client resolves BIMI (From domain first, then org domain). Brands with
 * no captured mail fall back to their website host. No Public Suffix List is
 * needed: querying a public suffix (co.uk) simply returns nothing, harmlessly.
 *
 * SAFETY — read-only against DNS; the only writes are upserts into the dedicated
 * `brand_auth_status` table. Runs as a DRY RUN by default (prints a summary and
 * per-brand rows); pass --apply to persist. Re-runnable any time; safe to cron.
 *
 * Run with:
 *   npx --yes tsx scripts/check-brand-auth.ts
 *   npx --yes tsx scripts/check-brand-auth.ts --apply
 *
 * Flags:
 *   --apply           Persist results. Without it, nothing is written.
 *   --limit=<n>       Only process the first <n> brands (by mail volume).
 *   --company=<id>    Only process brand <id>. Repeatable.
 *   --concurrency=<n> Parallel DNS lookups (default 12).
 *   --verbose         Print a line for every brand, not just a summary.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTxt } from "node:dns/promises";
import { X509Certificate } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";

type CliOptions = {
  apply: boolean;
  limit: number | null;
  onlyCompanies: Set<string> | null;
  concurrency: number;
  verbose: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    apply: false,
    limit: null,
    onlyCompanies: null,
    concurrency: 12,
    verbose: false
  };
  for (const raw of argv) {
    if (raw === "--apply") {
      opts.apply = true;
    } else if (raw === "--verbose") {
      opts.verbose = true;
    } else if (raw.startsWith("--limit=")) {
      const v = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(v) && v > 0) opts.limit = v;
    } else if (raw.startsWith("--concurrency=")) {
      const v = Number.parseInt(raw.slice("--concurrency=".length), 10);
      if (Number.isFinite(v) && v > 0) opts.concurrency = v;
    } else if (raw.startsWith("--company=")) {
      const value = raw.slice("--company=".length).trim();
      if (value) (opts.onlyCompanies ??= new Set()).add(value);
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

// --- domain helpers -------------------------------------------------------

/** Reduce a raw domain/URL/email to a bare lowercase host, or null. */
function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split(/[/?#]/)[0];
  s = s.split(":")[0];
  s = s.replace(/\.$/, "");
  if (!s.includes(".") || /\s/.test(s)) return null;
  return s;
}

/**
 * Candidate lookup domains, walking upward from the full host to its 2-label
 * tail: e.arket.com -> [e.arket.com, arket.com]. The first that publishes a
 * record wins, mirroring how a mail client resolves BIMI (author domain, then
 * organisational domain). Querying a public suffix returns nothing, so no PSL
 * is required to stop early.
 */
function candidateDomains(host: string): string[] {
  const labels = host.split(".");
  const out: string[] = [];
  for (let i = 0; i + 2 <= labels.length; i++) {
    out.push(labels.slice(i).join("."));
  }
  return out.length ? out : [host];
}

async function lookupTxt(name: string): Promise<string[]> {
  try {
    // resolveTxt returns string[][] (each record can be split into chunks).
    const records = await resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

type DmarcResult = { domain: string; policy: string; pct: number } | null;

/**
 * Find the DMARC record for a host, walking up to the org domain. `pct` is the
 * percentage of mail the policy applies to (defaults to 100 when the tag is
 * absent, per RFC 7489). It matters because BIMI only renders at *full*
 * enforcement — a `p=reject; pct=0` record looks strict but exempts every
 * message, so mailbox providers treat it as unenforced. We surface pct so the
 * "DMARC enforced" gate can require it to be 100.
 */
async function resolveDmarc(host: string): Promise<DmarcResult> {
  for (const d of candidateDomains(host)) {
    const txts = await lookupTxt(`_dmarc.${d}`);
    const rec = txts.find((t) => /v=dmarc1/i.test(t));
    if (rec) {
      const m = rec.match(/\bp=\s*([a-z]+)/i);
      const pctRaw = rec.match(/\bpct=\s*(\d{1,3})/i)?.[1];
      const pct = pctRaw === undefined ? 100 : Math.max(0, Math.min(100, Number(pctRaw)));
      return { domain: d, policy: (m?.[1] ?? "none").toLowerCase(), pct };
    }
  }
  return null;
}

/** DMARC counts as enforced for BIMI only at a strict policy AND full coverage. */
function isDmarcEnforced(dmarc: DmarcResult): boolean {
  if (!dmarc) return false;
  return (dmarc.policy === "quarantine" || dmarc.policy === "reject") && dmarc.pct === 100;
}

type BimiResult = {
  domain: string;
  logoUrl: string | null;
  vmcUrl: string | null;
} | null;

/** Find the BIMI record for a host, walking up to the org domain. */
async function resolveBimi(host: string): Promise<BimiResult> {
  for (const d of candidateDomains(host)) {
    const txts = await lookupTxt(`default._bimi.${d}`);
    const rec = txts.find((t) => /v=bimi1/i.test(t));
    if (rec) {
      const l = rec.match(/\bl=\s*([^;]*)/i)?.[1]?.trim() || null;
      const a = rec.match(/\ba=\s*([^;]*)/i)?.[1]?.trim() || null;
      return { domain: d, logoUrl: l || null, vmcUrl: a || null };
    }
  }
  return null;
}

// --- resource validation --------------------------------------------------

/**
 * Fetch a URL with a short timeout and a real User-Agent. Some cert/logo hosts
 * (e.g. Entrust's) 404 on requests they can't attribute, so we always identify
 * ourselves. Returns null on any network / status failure.
 */
async function fetchResource(
  url: string,
  as: "text" | "head"
): Promise<{ status: number; contentType: string; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: as === "head" ? "HEAD" : "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "PirolBot/1.0 (+https://pirol.app; email-authentication check)",
        accept: "application/pem-certificate-chain,application/x-pem-file,image/svg+xml,*/*"
      }
    });
    const contentType = res.headers.get("content-type") ?? "";
    const body = as === "text" ? await res.text() : "";
    return { status: res.status, contentType, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Confirm the BIMI logo URL actually resolves (HTTP 200). Not a download of
 *  the image — just liveness, since a dead logo means nothing renders. */
async function checkLogo(url: string | null): Promise<boolean> {
  if (!url || !/^https:\/\//i.test(url)) return false;
  const head = await fetchResource(url, "head");
  if (head && head.status >= 200 && head.status < 300) return true;
  // Some CDNs reject HEAD; fall back to a GET and just read the status.
  const get = await fetchResource(url, "text");
  return Boolean(get && get.status >= 200 && get.status < 300);
}

type VmcValidation = {
  valid: boolean;
  ca: string | null;
  markType: "VMC" | "CMC" | null;
  org: string | null;
  reason: string | null; // set when advertised but not valid
};

function leafPem(text: string): string | null {
  const m = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  return m ? m[0] : null;
}

function rdn(dn: string, key: string): string | null {
  // node's cert.issuer / cert.subject are newline-separated "K=V" lines.
  const line = dn.split("\n").find((l) => l.trim().toUpperCase().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim() : null;
}

function caLabel(issuerO: string | null): string | null {
  if (!issuerO) return null;
  if (/digicert/i.test(issuerO)) return "DigiCert";
  if (/entrust/i.test(issuerO)) return "Entrust";
  if (/globalsign/i.test(issuerO)) return "GlobalSign";
  if (/sectigo/i.test(issuerO)) return "Sectigo";
  return issuerO;
}

/**
 * Fetch and validate an advertised VMC. A certificate only earns the "verified"
 * label if it actually resolves, parses, is currently in-date, was issued by a
 * mark CA (issuer names a "Verified Mark" / "Common Mark" authority — a plain
 * TLS cert never does), and covers the BIMI domain. Anything less is recorded
 * with a `reason` and does NOT count as verified.
 */
async function validateVmc(
  url: string,
  domains: string[]
): Promise<VmcValidation> {
  const fail = (reason: string): VmcValidation => ({
    valid: false,
    ca: null,
    markType: null,
    org: null,
    reason
  });
  if (!/^https:\/\//i.test(url)) return fail("bad_url");
  const res = await fetchResource(url, "text");
  if (!res) return fail("unreachable");
  if (res.status < 200 || res.status >= 300) return fail(`http_${res.status}`);
  const pem = leafPem(res.body);
  if (!pem) return fail("parse_error");

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    return fail("parse_error");
  }

  const issuerO = rdn(cert.issuer, "O");
  const issuerCn = rdn(cert.issuer, "CN") ?? "";
  const ca = caLabel(issuerO);
  const org = rdn(cert.subject, "O");
  const markType: "VMC" | "CMC" | null = /common\s*mark/i.test(issuerCn)
    ? "CMC"
    : /verified\s*mark|\bvmc\b|\bmark\b/i.test(issuerCn)
      ? "VMC"
      : null;

  const now = new Date();
  const notBefore = new Date(cert.validFrom);
  const notAfter = new Date(cert.validTo);
  const partial = { ca, markType, org };
  if (now < notBefore) return { valid: false, reason: "not_yet_valid", ...partial };
  if (now > notAfter) return { valid: false, reason: "expired", ...partial };
  // Issuer must be a mark-issuing CA, not a generic TLS CA reachable at the URL.
  if (!markType) return { valid: false, reason: "untrusted_issuer", ...partial };
  // The cert must cover the domain the BIMI record lives on (or its sender).
  const covers = domains.some((d) => {
    try {
      return Boolean(cert.checkHost(d));
    } catch {
      return false;
    }
  });
  if (!covers) return { valid: false, reason: "domain_mismatch", ...partial };

  return { valid: true, reason: null, ...partial };
}

type AuthTier = "verified" | "bimi" | "bimi_inactive" | "dmarc" | "none";

/**
 * Derive the headline tier from *validated* facts. "verified" and the BIMI
 * tiers require the logo to actually resolve (`logoOk`) and, for verified, the
 * cert to validate (`vmcValid`) — so a brand whose BIMI assets 404 or whose VMC
 * is expired/unreachable is never over-labelled. `bimiEffective` folds the tag
 * and the working logo together.
 */
function classify(input: {
  dmarcEnforced: boolean;
  bimiEffective: boolean;
  vmcValid: boolean;
}): AuthTier {
  const { dmarcEnforced, bimiEffective, vmcValid } = input;
  if (dmarcEnforced && vmcValid && bimiEffective) return "verified";
  if (dmarcEnforced && bimiEffective) return "bimi";
  if (bimiEffective && !dmarcEnforced) return "bimi_inactive";
  if (dmarcEnforced) return "dmarc";
  return "none";
}

// --- brand -> evaluation domain ------------------------------------------

type Brand = { id: string; name: string; website: string | null };

/**
 * Pick each brand's dominant sender domain (most common From domain across its
 * captured mail). Brands with no mail get their website host as a fallback.
 */
async function resolveEvalDomains(
  client: SupabaseClient<Database>,
  brands: Brand[]
): Promise<Map<string, string | null>> {
  const evalDomain = new Map<string, string | null>();
  const counts = new Map<string, Map<string, number>>(); // companyId -> host -> n

  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from("captured_emails")
      .select("company_id, sender_email")
      .not("company_id", "is", null)
      .not("sender_email", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const cid = row.company_id as string | null;
      const host = normalizeHost(row.sender_email as string | null);
      if (!cid || !host) continue;
      const m = counts.get(cid) ?? new Map<string, number>();
      m.set(host, (m.get(host) ?? 0) + 1);
      counts.set(cid, m);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  for (const b of brands) {
    const m = counts.get(b.id);
    let best: string | null = null;
    if (m && m.size) {
      best = Array.from(m.entries()).sort((a, z) => z[1] - a[1])[0][0];
    }
    evalDomain.set(b.id, best ?? normalizeHost(b.website));
  }
  return evalDomain;
}

// --- concurrency ----------------------------------------------------------

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// --- main -----------------------------------------------------------------

type Row = Database["public"]["Tables"]["brand_auth_status"]["Insert"];

async function main(): Promise<void> {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const client = buildAdminClient();

  let query = client
    .from("companies")
    .select("id, name, domain")
    .is("deleted_at", null);
  if (opts.onlyCompanies) {
    query = query.in("id", Array.from(opts.onlyCompanies));
  }
  const { data: companies, error } = await query;
  if (error) {
    console.error("Failed to load companies:", error.message);
    process.exit(1);
  }
  let brands: Brand[] = (companies ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string | null) ?? "(unnamed)",
    website: c.domain as string | null
  }));

  console.log(`Resolving sender domains for ${brands.length} brands...`);
  const evalDomains = await resolveEvalDomains(client, brands);

  // Process highest-signal brands first; honour --limit.
  brands = brands.filter((b) => evalDomains.get(b.id));
  if (opts.limit) brands = brands.slice(0, opts.limit);
  console.log(`Checking DNS for ${brands.length} brands (concurrency ${opts.concurrency})...\n`);

  const rows = await mapPool(brands, opts.concurrency, async (b) => {
    const host = evalDomains.get(b.id)!;
    try {
      const [dmarc, bimi] = await Promise.all([
        resolveDmarc(host),
        resolveBimi(host)
      ]);
      const dmarcEnforced = isDmarcEnforced(dmarc);
      const bimiPresent = Boolean(bimi?.logoUrl);
      const vmcPresent = Boolean(bimi?.vmcUrl);

      // Only pay for network validation when the DNS record claims something to
      // validate. The logo and the cert are checked in parallel.
      //
      // A VMC is issued at the organisational-domain level, but a brand may
      // publish its BIMI record at a sending subdomain (e.g. e.lucidmotors.com
      // with a cert for lucidmotors.com). So we accept the cert if it covers
      // ANY level from the sender down to the org domain — the same walk-up
      // used for DNS — not just the exact record domain.
      const domainsForCert = Array.from(
        new Set([
          ...candidateDomains(host),
          ...(bimi?.domain ? candidateDomains(bimi.domain) : [])
        ])
      );
      const [logoOk, vmc] = await Promise.all([
        bimiPresent ? checkLogo(bimi!.logoUrl) : Promise.resolve(false),
        vmcPresent
          ? validateVmc(bimi!.vmcUrl!, domainsForCert)
          : Promise.resolve(null as VmcValidation | null)
      ]);
      const vmcValid = Boolean(vmc?.valid);
      const bimiEffective = bimiPresent && logoOk;
      const tier = classify({ dmarcEnforced, bimiEffective, vmcValid });

      const row: Row = {
        company_id: b.id,
        sender_domain: host,
        auth_domain: bimi?.domain ?? dmarc?.domain ?? null,
        dmarc_policy: dmarc?.policy ?? null,
        dmarc_pct: dmarc?.pct ?? null,
        dmarc_enforced: dmarcEnforced,
        bimi_present: bimiPresent,
        bimi_logo_url: bimi?.logoUrl ?? null,
        logo_ok: bimiPresent ? logoOk : null,
        vmc_present: vmcPresent,
        // Legacy host-guess kept for continuity; vmc_ca is the authoritative
        // CA read from the certificate itself.
        vmc_issuer: normalizeHost(bimi?.vmcUrl ?? null),
        vmc_valid: vmcValid,
        vmc_ca: vmc?.ca ?? null,
        vmc_mark_type: vmc?.markType ?? null,
        vmc_org: vmc?.org ?? null,
        vmc_invalid_reason: vmcPresent && !vmcValid ? vmc?.reason ?? "unknown" : null,
        auth_tier: tier,
        error: null
      };
      if (opts.verbose) {
        const flag =
          vmcPresent && !vmcValid
            ? ` VMC!${vmc?.reason ?? ""}`
            : bimiPresent && !logoOk
              ? " LOGO!404"
              : "";
        console.log(
          `${tier.padEnd(14)} ${host.padEnd(34)} dmarc=${(dmarc?.policy ?? "-").padEnd(10)}${flag} ${b.name}`
        );
      }
      return row;
    } catch (e) {
      const row: Row = {
        company_id: b.id,
        sender_domain: host,
        auth_tier: "none",
        error: e instanceof Error ? e.message : String(e)
      };
      return row;
    }
  });

  // Summary.
  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.auth_tier!, (tally.get(r.auth_tier!) ?? 0) + 1);
  const order: AuthTier[] = ["verified", "bimi", "bimi_inactive", "dmarc", "none"];
  const label: Record<AuthTier, string> = {
    verified: "BIMI + VMC (verified)",
    bimi: "BIMI logo (no VMC)",
    bimi_inactive: "BIMI present but DMARC not enforced",
    dmarc: "DMARC enforced, no BIMI (eligible)",
    none: "no enforced DMARC / no BIMI"
  };
  console.log("\n=== Adoption summary ===");
  for (const t of order) {
    const n = tally.get(t) ?? 0;
    const pct = rows.length ? ((n / rows.length) * 100).toFixed(1) : "0.0";
    console.log(`  ${String(n).padStart(4)}  ${pct.padStart(5)}%  ${label[t]}`);
  }
  const verified = rows.filter((r) => r.auth_tier === "verified");
  if (verified.length) {
    console.log("\nVerified senders (validated BIMI + VMC):");
    for (const r of verified) {
      const ca = r.vmc_ca ? ` [${r.vmc_ca}${r.vmc_mark_type ? ` ${r.vmc_mark_type}` : ""}]` : "";
      console.log(`  ${r.sender_domain}${ca}`);
    }
  }

  // The whole point of validation: brands that *advertise* a VMC but whose
  // cert didn't check out (so they are NOT verified). Surface them explicitly.
  const brokenVmc = rows.filter(
    (r) => r.vmc_present && !r.vmc_valid && r.vmc_invalid_reason
  );
  if (brokenVmc.length) {
    console.log(`\nAdvertised VMC that did NOT validate (${brokenVmc.length}):`);
    for (const r of brokenVmc) {
      console.log(
        `  ${(r.sender_domain ?? "").padEnd(34)} ${r.vmc_invalid_reason}  (now: ${r.auth_tier})`
      );
    }
  }
  const brokenLogo = rows.filter((r) => r.bimi_present && r.logo_ok === false);
  if (brokenLogo.length) {
    console.log(`\nBIMI record with an unreachable logo (${brokenLogo.length}):`);
    for (const r of brokenLogo) {
      console.log(`  ${(r.sender_domain ?? "").padEnd(34)} (now: ${r.auth_tier})`);
    }
  }

  if (!opts.apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to persist.");
    return;
  }

  // Upsert in chunks.
  const chunkSize = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      ...r,
      checked_at: new Date().toISOString()
    }));
    const { error: upErr } = await client
      .from("brand_auth_status")
      .upsert(chunk, { onConflict: "company_id" });
    if (upErr) {
      console.error("Upsert failed:", upErr.message);
      process.exit(1);
    }
    written += chunk.length;
  }
  console.log(`\nWrote ${written} rows to brand_auth_status.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
