/**
 * One-off debug script: scores every <img> in a single captured_emails row
 * and prints the candidates with their reasons. Usage:
 *
 *   npx --yes tsx scripts/debug-logo-score.ts <email_id>
 *   npx --yes tsx scripts/debug-logo-score.ts --domain=<domain>
 *     (uses the most recent email for that company)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { scoreLogoCandidatesFromHtml } from "../lib/extract-logo";
import type { Database } from "../types/supabase";

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

function guessContentType(storagePath: string): string {
  const lower = storagePath.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

async function main(): Promise<void> {
  loadDotEnvLocal();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: debug-logo-score.ts <email_id> | --domain=<domain>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let emailId: string | null = null;
  if (args[0].startsWith("--domain=")) {
    const domain = args[0].slice("--domain=".length);
    const { data: companies } = await supabase
      .from("companies")
      .select("id")
      .ilike("domain", `%${domain}%`)
      .limit(1);
    if (!companies || companies.length === 0) {
      console.error(`No company matches domain ${domain}`);
      process.exit(1);
    }
    const { data: emails } = await supabase
      .from("captured_emails")
      .select("id")
      .eq("company_id", companies[0].id)
      .order("received_at", { ascending: false })
      .limit(1);
    if (!emails || emails.length === 0) {
      console.error(`Company ${domain} has no captured emails`);
      process.exit(1);
    }
    emailId = emails[0].id;
  } else {
    emailId = args[0];
  }

  const { data: email, error } = await supabase
    .from("captured_emails")
    .select("id, html_content, image_urls, metadata, companies(domain)")
    .eq("id", emailId)
    .maybeSingle();
  if (error || !email) {
    console.error("Email not found:", error?.message ?? "no row");
    process.exit(1);
  }

  const company = Array.isArray(email.companies) ? email.companies[0] : email.companies;
  const companyDomain = company?.domain ?? "";
  const mirrorMap = parseImageMirrorMap(email.metadata);
  const storagePaths = new Set(email.image_urls ?? []);

  const mirroredAssets = Object.entries(mirrorMap)
    .filter(([, path]) => storagePaths.has(path))
    .map(([remoteUrl, storagePath]) => ({
      remoteUrl,
      storagePath,
      contentType: guessContentType(storagePath),
      byteLength: 0
    }));

  console.log("\n=== Email", emailId, "===");
  console.log("Company domain:", companyDomain);
  console.log("HTML length:", email.html_content?.length ?? 0);
  console.log("image_urls count:", email.image_urls?.length ?? 0);
  console.log("image_mirror_map size:", Object.keys(mirrorMap).length);
  console.log("matched mirrored assets:", mirroredAssets.length);

  if (mirroredAssets.length === 0) {
    console.log("\nNo mirrored assets matched image_urls. mirror_map keys:");
    for (const k of Object.keys(mirrorMap).slice(0, 5)) console.log("  ", k);
    console.log("image_urls (first 5):");
    for (const p of (email.image_urls ?? []).slice(0, 5)) console.log("  ", p);
    process.exit(0);
  }

  // Show all <img> srcs found in the HTML for context.
  const imgSrcs = Array.from(
    (email.html_content ?? "").matchAll(/<img[^>]+src=["']([^"']+)["']/gi)
  ).map((m) => m[1]);
  console.log("\n<img src=...> count in html:", imgSrcs.length);
  for (const src of imgSrcs.slice(0, 12)) {
    const inMirror = mirrorMap[src] ? "[mirror]" : "[no mirror]";
    console.log(" ", inMirror, src);
  }

  const candidates = scoreLogoCandidatesFromHtml({
    html: email.html_content ?? "",
    companyDomain,
    mirroredAssets
  });

  console.log("\nCandidates:", candidates.length);
  for (const c of candidates.slice(0, 8)) {
    console.log(
      `  score=${c.score.toString().padStart(4)}  ${c.storagePath}\n    reasons: ${c.reasons.join(", ")}\n    remote: ${c.remoteUrl}`
    );
  }
}

main().catch((error) => {
  console.error("debug-logo-score failed:", error);
  process.exit(1);
});
