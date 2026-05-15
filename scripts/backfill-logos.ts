/**
 * Resolves a logo for every subscribed company that doesn't have one yet.
 *
 * For each candidate company we walk the most recent N captured emails,
 * reconstruct the mirrored-asset list from each email's metadata, and run
 * the heuristic + frequency picker. Companies whose top candidate doesn't
 * clear the heuristic threshold are left logo-less — the UI renders a
 * monogram fallback until more emails arrive and either the heuristic
 * clears 60 or the frequency picker locks in a repeated image.
 *
 * Run with:
 *   npx --yes tsx scripts/backfill-logos.ts
 *
 * Flags:
 *   --dry-run            Don't write any logo_* columns, just print what
 *                        would be picked.
 *   --force              Re-process companies that already have a logo, but
 *                        only upgrade if the replace policy approves (manual
 *                        sources are still untouched).
 *   --limit=<n>          Process at most <n> companies.
 *   --max-emails=<n>     Look at the N most recent emails per company.
 *                        Defaults to 10.
 *   --domain=<value>     Only process companies whose domain matches exactly
 *                        (repeatable, useful for spot checks).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  scoreLogoCandidatesFromHtml,
  LOGO_FREQUENCY_MIN_EMAILS,
  pickLogoByFrequency
} from "../lib/extract-logo";
import type { Database } from "../types/supabase";

type CliOptions = {
  dryRun: boolean;
  force: boolean;
  limit: number | null;
  maxEmails: number;
  onlyDomains: Set<string> | null;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    force: false,
    limit: null,
    maxEmails: 10,
    onlyDomains: null
  };
  for (const raw of argv) {
    if (raw === "--dry-run") {
      opts.dryRun = true;
    } else if (raw === "--force") {
      opts.force = true;
    } else if (raw.startsWith("--limit=")) {
      const parsed = Number.parseInt(raw.slice("--limit=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        opts.limit = parsed;
      }
    } else if (raw.startsWith("--max-emails=")) {
      const parsed = Number.parseInt(raw.slice("--max-emails=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        opts.maxEmails = parsed;
      }
    } else if (raw.startsWith("--domain=")) {
      const value = raw.slice("--domain=".length).trim().toLowerCase();
      if (value) {
        if (!opts.onlyDomains) {
          opts.onlyDomains = new Set<string>();
        }
        opts.onlyDomains.add(value);
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

type EmailRow = {
  id: string;
  html_content: string | null;
  image_urls: string[] | null;
  remote_image_urls: string[] | null;
  metadata: unknown;
};

type CompanyRow = {
  id: string;
  name: string;
  domain: string;
  logo_storage_path: string | null;
  logo_source: string | null;
};

function parseImageMirrorMap(metadata: unknown): Record<string, string> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const candidate = (metadata as Record<string, unknown>).image_mirror_map;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [remote, path] of Object.entries(candidate)) {
    if (typeof remote === "string" && typeof path === "string") {
      out[remote] = path;
    }
  }
  return out;
}

/**
 * Reconstructs `MirroredImage[]` from a captured_emails row. Byte length and
 * MIME type aren't stored on the email so we approximate from the file
 * extension — enough for the scorer to use the format heuristic; we don't
 * have size weighting without a full re-mirror.
 */
function reconstructMirroredAssets(row: EmailRow): {
  remoteUrl: string;
  storagePath: string;
  contentType: string;
  byteLength: number;
}[] {
  const mirrorMap = parseImageMirrorMap(row.metadata);
  const storagePaths = new Set(row.image_urls ?? []);
  const out: {
    remoteUrl: string;
    storagePath: string;
    contentType: string;
    byteLength: number;
  }[] = [];

  for (const [remoteUrl, storagePath] of Object.entries(mirrorMap)) {
    if (!storagePaths.has(storagePath)) {
      continue;
    }
    out.push({
      remoteUrl,
      storagePath,
      contentType: guessContentType(storagePath),
      byteLength: 0
    });
  }
  return out;
}

function guessContentType(storagePath: string): string {
  const lower = storagePath.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

async function processCompany(
  supabase: SupabaseClient<Database>,
  company: CompanyRow,
  opts: CliOptions
): Promise<string> {
  if (company.logo_source === "manual") {
    return `${company.domain}: skip (manual override)`;
  }
  if (!opts.force && company.logo_storage_path !== null) {
    return `${company.domain}: skip (already has ${company.logo_source ?? "logo"})`;
  }

  const { data: emails, error: emailError } = await supabase
    .from("captured_emails")
    .select("id, html_content, image_urls, remote_image_urls, metadata")
    .eq("company_id", company.id)
    .order("received_at", { ascending: false })
    .limit(opts.maxEmails);

  if (emailError) {
    return `${company.domain}: emails query failed (${emailError.message})`;
  }

  const rows = (emails ?? []) as EmailRow[];
  const emailsWithMirror = rows.filter((row) => {
    const map = parseImageMirrorMap(row.metadata);
    return row.html_content && Object.keys(map).length > 0;
  }).length;

  // Score each email and remember the global best.
  let best: {
    score: number;
    storagePath: string;
    confidence: number;
  } | null = null;

  for (const row of rows) {
    const mirrored = reconstructMirroredAssets(row);
    if (!row.html_content || mirrored.length === 0) {
      continue;
    }
    const candidates = scoreLogoCandidatesFromHtml({
      html: row.html_content,
      companyDomain: company.domain,
      mirroredAssets: mirrored
    });
    if (candidates.length === 0) {
      continue;
    }
    const top = candidates[0];
    if (!best || top.score > best.score) {
      best = {
        score: top.score,
        storagePath: top.storagePath,
        confidence: top.confidence
      };
    }
  }

  // Frequency picker can replace the heuristic best if we have enough mail.
  let frequencyPath: string | null = null;
  if (rows.length >= LOGO_FREQUENCY_MIN_EMAILS) {
    const freq = await pickLogoByFrequency(company.id);
    if (freq) {
      frequencyPath = freq.storagePath;
    }
  }

  const choice = frequencyPath
    ? { storagePath: frequencyPath, source: "email_frequency", confidence: 0.85 }
    : best && best.score >= 60
      ? { storagePath: best.storagePath, source: "email_heuristic", confidence: best.confidence }
      : null;

  if (choice) {
    if (opts.dryRun) {
      return `${company.domain}: would set ${choice.source} -> ${choice.storagePath} (confidence ${choice.confidence.toFixed(2)})`;
    }
    const { error: updateError } = await supabase
      .from("companies")
      .update({
        logo_storage_path: choice.storagePath,
        logo_source: choice.source,
        logo_confidence: choice.confidence,
        logo_updated_at: new Date().toISOString()
      })
      .eq("id", company.id);
    if (updateError) {
      return `${company.domain}: write failed (${updateError.message})`;
    }
    return `${company.domain}: set ${choice.source} -> ${choice.storagePath}`;
  }

  const diagnosis = (() => {
    if (rows.length === 0) return "no emails";
    if (emailsWithMirror === 0) return `${rows.length} email(s) but no image_mirror_map`;
    if (best) return `top score ${best.score} (need 60), ${rows.length} email(s)`;
    return `${emailsWithMirror}/${rows.length} email(s) had mirrors but no candidates`;
  })();

  return `${company.domain}: no logo picked [${diagnosis}]`;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const supabase = buildAdminClient();

  let query = supabase
    .from("companies")
    .select("id, name, domain, logo_storage_path, logo_source")
    .is("deleted_at", null)
    .order("subscribed_since", { ascending: true });

  if (!opts.force) {
    query = query.is("logo_storage_path", null);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to list companies:", error.message);
    process.exit(1);
  }

  let companies = (data ?? []) as CompanyRow[];
  if (opts.onlyDomains) {
    companies = companies.filter((row) =>
      opts.onlyDomains!.has(row.domain.toLowerCase())
    );
  }
  if (opts.limit !== null) {
    companies = companies.slice(0, opts.limit);
  }

  console.log(`Processing ${companies.length} compan${companies.length === 1 ? "y" : "ies"}...`);

  for (const company of companies) {
    const message = await processCompany(supabase, company, opts);
    console.log(`  - ${message}`);
  }
}

main().catch((error) => {
  console.error("backfill-logos failed:", error);
  process.exit(1);
});
