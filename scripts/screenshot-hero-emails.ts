/**
 * Pre-bakes thumbnail images of the showcase newsletters for the homepage hero
 * + login fan, so the page loads 14 small self-hosted WebPs instead of 14 live
 * iframes (each of which pulls dozens of remote brand-CDN images).
 *
 * Renders each `public/hero-emails/{id}.html` snapshot in headless Chromium,
 * screenshots the top slice (the part the fanned cards reveal), and writes
 * `public/hero-emails/{id}.webp`.
 *
 * Run AFTER `snapshot-hero-emails.ts` (which produces the .html):
 *   npx --yes tsx scripts/screenshot-hero-emails.ts
 *
 * Re-run whenever the snapshots or the showcase list change.
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";
import { LOGIN_SHOWCASE } from "../lib/marketing/login-showcase";

const DIR = resolve(process.cwd(), "public", "hero-emails");

// Match the fan's crop: emails are ~600px wide; cards reveal the top ~760px.
const WIDTH = 600;
const HEIGHT = 760;
// Output width — generous enough to stay crisp on retina at the card's
// on-screen size (~330px), while keeping files small.
const OUTPUT_WIDTH = 800;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2
  });

  for (const { id, brand } of LOGIN_SHOWCASE) {
    const htmlPath = resolve(DIR, `${id}.html`);
    if (!existsSync(htmlPath)) {
      console.error(`✗ ${brand}: missing snapshot ${id}.html — run snapshot-hero-emails first`);
      process.exitCode = 1;
      continue;
    }

    // `load` waits for top images; some emails carry slow tracking requests,
    // so cap it and fall through to a short settle wait regardless.
    await page
      .goto(`file://${htmlPath}`, { waitUntil: "load", timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1200);

    const png = await page.screenshot({
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }
    });

    const out = resolve(DIR, `${id}.webp`);
    await sharp(png).resize({ width: OUTPUT_WIDTH }).webp({ quality: 80 }).toFile(out);
    console.log(`✓ ${brand} → ${id}.webp`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
