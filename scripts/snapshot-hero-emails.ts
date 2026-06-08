/**
 * Snapshots the real HTML payloads of the three hero-rotation emails so the
 * landing page can render them faithfully (instead of a hand-built facsimile).
 *
 * Run with:
 *   npx --yes tsx scripts/snapshot-hero-emails.ts
 *
 * Re-run after `lib/marketing/hero-data.ts` is updated with new hero email IDs,
 * or whenever the underlying captured_emails rows change.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import { LOGIN_SHOWCASE } from "../lib/marketing/login-showcase";

const HERO_EMAIL_IDS: string[] = [
  "7002d123-edc8-4669-a4db-990a3ba56e08", // HAY — Take dining outside
  "f15538ab-51fa-4147-85ee-952aa8cfd16b", // Audo Copenhagen — Portable Lamps
  "080f1c61-dc56-41fb-8532-2ac56d7dda6e"  // Ferm Living — Free shipping
];

// The login page fans a wider set of real newsletters; snapshot those too.
// De-duped against the hero set so we don't fetch the same email twice.
const SNAPSHOT_IDS: string[] = Array.from(
  new Set([...HERO_EMAIL_IDS, ...LOGIN_SHOWCASE.map((n) => n.id)])
);

const OUT_DIR = resolve(process.cwd(), "public", "hero-emails");

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wraps a captured email body in a minimal HTML document so the iframe
 * always has a clean rendering context. Matches the wrap used in
 * `app/api/admin/emails/[id]/render/route.ts` so the inbox view stays
 * visually identical between admin and the marketing site.
 *
 * When the captured payload is already a full document, we inject a small
 * `<style>` tag with the hero-specific tweaks (hidden scrollbars, no body
 * margin) into the existing <head> so the iframe sits flush inside the
 * landing-page email card.
 */
const HERO_FRAME_STYLE = `<style data-hero-frame>
  html, body { margin: 0 !important; padding: 0 !important; }
  /* Hide internal scrollbars — the outer hero card carries its own fade. */
  html { scrollbar-width: none; -ms-overflow-style: none; }
  html::-webkit-scrollbar { width: 0; height: 0; display: none; }
  /* Render links inert. We also strip href/target attributes from the HTML
     below, but this is a belt-and-braces guard in case any escape past the
     regex (e.g. server-rendered <area> maps, future captures). */
  a { pointer-events: none !important; cursor: default !important; }
</style>`;

/**
 * Removes click handlers from the captured email HTML so visitors of the
 * landing page can't accidentally click through to brand sites or, worse,
 * unsubscribe the demo inbox from those newsletters.
 *
 * We keep the <a> tags themselves (so the link text stays styled exactly
 * as designed) but drop the navigation-related attributes. CSS in
 * HERO_FRAME_STYLE additionally disables pointer events.
 */
function disarmLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
    const stripped = attrs
      .replace(/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\sonclick\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `<a${stripped} data-hero-disarmed>`;
  });
}

function wrapHtml(body: string, subject: string): string {
  const looksLikeFullDocument = /<html[\s>]/i.test(body);
  if (looksLikeFullDocument) {
    if (/<head[\s>]/i.test(body)) {
      return body.replace(/<head([^>]*)>/i, (m) => `${m}${HERO_FRAME_STYLE}`);
    }
    // Has <html> but no <head> — inject one.
    return body.replace(
      /<html([^>]*)>/i,
      (m) => `${m}<head>${HERO_FRAME_STYLE}</head>`
    );
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(subject || "Captured email")}</title>
    ${HERO_FRAME_STYLE}
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #ffffff; }
      img { max-width: 100%; height: auto; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
${body}
  </body>
</html>`;
}

async function main() {
  loadDotEnvLocal();
  const supabase = buildAdminClient();

  mkdirSync(OUT_DIR, { recursive: true });

  for (const id of SNAPSHOT_IDS) {
    const { data, error } = await supabase
      .from("captured_emails")
      .select("id, subject, html_content")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error(`Failed to fetch ${id}:`, error.message);
      process.exitCode = 1;
      continue;
    }
    if (!data || !data.html_content) {
      console.error(`No html_content for ${id}`);
      process.exitCode = 1;
      continue;
    }

    const disarmed = disarmLinks(data.html_content);
    const wrapped = wrapHtml(disarmed, data.subject ?? "");
    const outPath = resolve(OUT_DIR, `${id}.html`);
    writeFileSync(outPath, wrapped, "utf8");
    console.log(`✓ wrote ${outPath} (${wrapped.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
