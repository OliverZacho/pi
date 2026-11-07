import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveBrandLogo } from "@/lib/logo-dev";
import { BRAND_LOGO_TRANSFORM, getSignedAssets, type ImageTransform } from "@/lib/storage";
import { heroImageCandidates } from "@/lib/notifications/email-thumbs";
import { parseImageStats } from "@/lib/image-stats";

/**
 * Data for the public Black Friday tracker (/black-friday) and its homepage
 * teaser. The numbers are computed in the database by black_friday_tracker()
 * and stored hourly in black_friday_snapshots (see the 20261107100000
 * migration); this only reads the latest row and resolves logos and preview
 * images, so a page regeneration costs one small query.
 *
 * The keyword list in METHOD_KEYWORDS must match the regex in that function.
 */

export const BLACK_FRIDAY = "2026-11-27";
export const CYBER_MONDAY = "2026-11-30";
export const SINGLES_DAY = "2026-11-11";
export const WINDOW_START = "2026-10-01";
export const WINDOW_END = "2026-12-02";

export const METHOD_KEYWORDS = [
  "Black Friday",
  "Black Week",
  "Black Weekend",
  "Black November",
  "Black Month",
  "Sort fredag",
  "Cyber Monday",
  "Cyber Week",
  "Cyber Weekend"
];

type BrandRef = { brand: string };
type Dated = { d: string };

export type BfSnapshot = {
  generated_at: string;
  through: string;
  headline: {
    brands_tracked: number;
    brands_live: number;
    bf_emails: number;
    median_discount: number | null;
    brands_extended: number;
    deadline_share: number | null;
    volume_lift: number | null;
    cyber_share: number | null;
  };
  daily: { d: string; bf: number; all: number }[];
  lead: {
    buckets: { w: number; n: number }[] | null;
    earliest: (BrandRef & { first_day: string; days_before: number })[] | null;
  };
  discounts: {
    buckets: { k: number; n: number }[] | null;
    by_category: { label: string; median: number; brands: number }[] | null;
    by_country: { label: string; median: number; brands: number }[] | null;
    deepest: (BrandRef & Dated & { pct: number; subject: string | null })[] | null;
  };
  windows: (BrandRef & { start: string; first_end: string; end: string; extended: boolean })[];
  loudest: (BrandRef & { n: number; base_week: number })[];
  peak: { d: string; n: number } | null;
  subjects: {
    avg_length: number | null;
    emoji_share: number | null;
    caps_share: number | null;
    early_access_share: number | null;
    free_shipping_share: number | null;
    promo_code_share: number | null;
    top_words: { w: string; n: number }[] | null;
    examples: (BrandRef & Dated & { subject: string })[] | null;
  };
  design: {
    gif_bf: number | null;
    gif_base: number | null;
    dark_bf: number | null;
    dark_base: number | null;
  };
  optouts: (BrandRef & Dated & { subject: string | null })[];
  gallery: (BrandRef & Dated & { id: string; subject: string | null; pct: number | null })[];
  brands: Record<
    string,
    {
      name: string;
      slug: string;
      domain: string | null;
      logo_path: string | null;
      logo_source: string | null;
      country: string | null;
    }
  >;
};

export type BfBrand = { name: string; slug: string; logoUrl: string | null; country: string | null };

export type BlackFridayData = {
  snapshot: BfSnapshot;
  brands: Record<string, BfBrand>;
  /** Email id → cropped preview image URL (gallery only). */
  previews: Record<string, string>;
};

// Gallery cards render ~260 CSS px wide at a 4:5 aspect; 2x for HiDPI.
const GALLERY_TRANSFORM: ImageTransform = { width: 520, height: 650, quality: 70, fit: "crop" };

export async function loadBlackFriday(): Promise<BlackFridayData | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("black_friday_snapshots")
      .select("data")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const snapshot = data.data as unknown as BfSnapshot;

    const manual = Object.values(snapshot.brands)
      .filter((b) => b.logo_source === "manual" && b.logo_path)
      .map((b) => b.logo_path as string);

    const [signed, previews] = await Promise.all([
      manual.length
        ? getSignedAssets(manual, { transform: BRAND_LOGO_TRANSFORM }).catch(
            () => ({}) as Record<string, string>
          )
        : Promise.resolve({} as Record<string, string>),
      galleryPreviews(snapshot.gallery.map((g) => g.id))
    ]);

    const brands: Record<string, BfBrand> = {};
    for (const [id, b] of Object.entries(snapshot.brands)) {
      brands[id] = {
        name: b.name,
        slug: b.slug,
        country: b.country,
        logoUrl: resolveBrandLogo(b.logo_path ? signed[b.logo_path] ?? null : null, b.logo_source, b.domain)
      };
    }

    return { snapshot, brands, previews };
  } catch (err) {
    console.error("Black Friday tracker: load failed", err);
    return null;
  }
}

/**
 * Preview image per gallery email: the same hero pick the digest uses, from
 * stored byte sizes only. No image is fetched here; the digest's extra
 * dimension probe downloads whole images through Next's fetch cache inside
 * a cached page, which took minutes.
 */
async function galleryPreviews(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    const { data } = await getSupabaseAdmin()
      .from("captured_emails")
      .select("id, image_urls, image_stats:metadata->image_stats")
      .in("id", ids);
    const heroes = new Map<string, string>();
    for (const row of data ?? []) {
      const sizes: Record<string, number> = {};
      for (const a of parseImageStats({ image_stats: row.image_stats })?.assets ?? []) sizes[a.path] = a.bytes;
      const hero = heroImageCandidates(row.image_urls ?? [], sizes)[0];
      if (hero) heroes.set(row.id, hero);
    }
    const urls = await getSignedAssets([...heroes.values()], { transform: GALLERY_TRANSFORM });
    const out: Record<string, string> = {};
    for (const [id, path] of heroes) if (urls[path]) out[id] = urls[path];
    return out;
  } catch (err) {
    console.error("Black Friday tracker: previews failed", err);
    return {};
  }
}

export type BfHeadline = BfSnapshot["headline"] & { through: string };

/** Just the headline numbers, for the homepage teaser (null once the season is over). */
export async function loadBlackFridayHeadline(): Promise<BfHeadline | null> {
  if (Date.now() >= Date.parse("2027-01-01")) return null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("black_friday_snapshots")
      .select("headline:data->headline, through:data->>through")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.headline) return null;
    return { ...(data.headline as unknown as BfSnapshot["headline"]), through: String(data.through) };
  } catch {
    return null;
  }
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** "Nov 7" for a YYYY-MM-DD day. */
export function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

/** Where the season stands on a given day, for labels and the teaser. */
export function phaseLabel(day: string): string {
  const toGo = daysBetween(day, BLACK_FRIDAY);
  if (toGo > 1) return `${toGo} days to Black Friday`;
  if (toGo === 1) return "Black Friday is tomorrow";
  if (toGo === 0) return "Black Friday is today";
  if (day < CYBER_MONDAY) return "Black Friday weekend";
  if (day === CYBER_MONDAY) return "Cyber Monday is today";
  if (day <= WINDOW_END) return "Wrapping up the season";
  return "Final numbers";
}

export function pct(share: number | null | undefined): string {
  return share == null ? "n/a" : `${Math.round(share * 100)}%`;
}
