import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getBrandNarrative } from "@/lib/brand-claim-facts";
import { getBrandPageData, getBrandSummary } from "@/lib/brand-db";
import { canonicalUrl } from "@/lib/page-metadata";
import { MIN_INDEXABLE_EMAILS, proseDescription } from "@/lib/brand-summary";
import { resolveHandle } from "./resolve-handle";

/**
 * Request-memoised summary build, so `generateMetadata` and the page body each
 * run it once per request rather than twice. `getSupabaseAdmin` is a
 * singleton, so keying on the string args is stable.
 */
export const loadBrandSummary = cache((id: string, name: string) =>
  getBrandSummary(getSupabaseAdmin(), id, { name })
);

/**
 * The public teaser: the brand's real KPI tiles + send calendar, served to
 * *every* locked viewer — including logged-out visitors and crawlers. This is
 * what makes each brand page unique, honest content (no shared sample data in
 * the crawlable HTML). The heavy dashboard query is too expensive to run per
 * anonymous request, so the subset is cached across requests for an hour —
 * fine for a teaser that changes at most a few times a day.
 */
/**
 * The generated narrative (lib/brand-claims.ts). Reads the three claim-facts
 * views, which are keyed lookups rather than scans, but a brand's prose changes
 * at most a few times a day and crawler traffic hits this path 450 times, so it
 * is cached across requests for an hour alongside the teaser.
 */
export const loadBrandNarrative = unstable_cache(
  async (companyId: string, name: string) => {
    const narrative = await getBrandNarrative(getSupabaseAdmin(), companyId, {
      name
    });
    return narrative?.paragraphs ?? null;
  },
  ["brand-narrative"],
  { revalidate: 3600 }
);

export const loadPublicTeaser = unstable_cache(
  async (companyId: string) => {
    const data = await getBrandPageData(getSupabaseAdmin(), companyId);
    if (!data) return null;
    return {
      totals: data.totals,
      cadence: data.cadence,
      promo: data.promo,
      esp: data.esp,
      calendar: data.calendar
    };
  },
  ["brand-public-teaser"],
  { revalidate: 3600 }
);

/**
 * Brand page metadata, shared by the signed-in route and the cached guest
 * route (app/guest/brands/[id]).
 *
 * `narrative: false` skips the generated narrative and describes the page
 * with the one-sentence summary instead. The signed-in route passes it: the
 * narrative only feeds the meta description, which matters to crawlers, and
 * crawlers are cookieless so they always get the guest route. Signed-in
 * browsers run this for every brand link they preload, so the saving is per
 * brand card on screen, not per page view.
 */
export async function brandPageMetadata(
  id: string,
  options: { narrative?: boolean } = {}
): Promise<Metadata> {
  const withNarrative = options.narrative ?? true;
  // Resolve via the service-role client: companies aren't readable under RLS
  // for logged-out visitors / crawlers, which is exactly who reads <head>.
  const resolved = await resolveHandle(id);
  if (!resolved) {
    return { title: "Brand — Pirol" };
  }

  // Canonical always points at the slug URL, so Google consolidates any
  // legacy /brands/<uuid> links onto the keyword-bearing slug without us
  // having to 301 (and slow down) internal navigation.
  const canonical = canonicalUrl(`/brands/${resolved.slug}`);
  const [summary, narrative] = await Promise.all([
    loadBrandSummary(resolved.id, resolved.name),
    withNarrative
      ? loadBrandNarrative(resolved.id, resolved.name).catch(() => null)
      : null
  ]);

  // Only pages with enough captured email to say something real are offered
  // to the index (same threshold as the sitemap). The rest stay reachable but
  // noindexed — hundreds of near-empty templates would read as scaled thin
  // content and drag every strong page down with them.
  const indexable =
    summary !== null && summary.emailCount >= MIN_INDEXABLE_EMAILS;

  // Keyword-bearing title: people find these pages searching
  // "<brand> email frequency / newsletter strategy", not "<brand> Pirol".
  const title = indexable
    ? `${resolved.name} email marketing: frequency, timing, discounts`
    : `${resolved.name} — Pirol`;

  // The narrative's opening sentences when the brand has one: they vary in
  // what they say per brand, where the summary only varies in its numbers.
  const description = narrative?.length
    ? proseDescription(narrative.join(" "))
    : summary?.metaDescription ?? undefined;

  return {
    title,
    description,
    alternates: { canonical },
    // Full card rather than the bare url+title this used to ship: Next
    // replaces the root layout's openGraph wholesale when a page sets its own,
    // so every field has to be repeated here. See lib/page-metadata.ts for why
    // there's no og:image.
    openGraph: {
      type: "website",
      url: canonical,
      siteName: "Pirol",
      locale: "en",
      title,
      description
    },
    twitter: { card: "summary", title, description },
    robots: indexable ? undefined : { index: false, follow: true }
  };
}
