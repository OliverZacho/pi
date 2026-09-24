import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Absolute URL for a public path, always built from `SITE_URL` so hosts are
 * never hand-written. Google indexed the apex (`pirol.app`) instead of the
 * canonical `www` host precisely because most pages shipped without a
 * canonical tag, so every indexable page must declare one.
 */
export function canonicalUrl(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${SITE_URL}/${trimmed}` : SITE_URL;
}

type PageMetadataInput = {
  /** Full `<title>`, including the " — Pirol" suffix the site uses. */
  title: string;
  description: string;
  /** Path this page is served from, e.g. "/" or "/features/brands". */
  path: string;
  /** Social-card title, when the `<title>` reads badly out of context. */
  socialTitle?: string;
  /** Social-card description, when the meta description is too terse. */
  socialDescription?: string;
  /** Long-form pages (guides) are articles; everything else is a website. */
  type?: "website" | "article";
};

/**
 * Title + description + self-referencing canonical + Open Graph / Twitter
 * card for one indexable page.
 *
 * Next.js replaces (rather than merges) the `openGraph` and `twitter` objects
 * when a page overrides the root layout's, so this builds a complete card
 * every time instead of relying on inherited fields.
 *
 * No `og:image` is set: the site has no served raster image to point at, and
 * the one image asset it does have (`/icon.svg`) is an SVG, which Slack,
 * LinkedIn and X all ignore for social cards. Pointing at a 404 or an
 * unsupported format is worse than no image, same rule as the absent `logo`
 * in `lib/structured-data.ts`. Add `og:image` here once a real PNG/JPG
 * card exists.
 */
export function pageMetadata({
  title,
  description,
  path,
  socialTitle,
  socialDescription,
  type = "website"
}: PageMetadataInput): Metadata {
  const url = canonicalUrl(path);
  const ogTitle = socialTitle ?? title;
  const ogDescription = socialDescription ?? description;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type,
      url,
      siteName: "Pirol",
      locale: "en",
      title: ogTitle,
      description: ogDescription
    },
    // "summary" rather than "summary_large_image" — the large card renders as
    // a blank slab without an image. Switch it when og:image lands.
    twitter: {
      card: "summary",
      title: ogTitle,
      description: ogDescription
    }
  };
}
