import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_CATEGORY_LABELS,
  ESP_LABELS,
  NON_CAMPAIGN_CATEGORIES,
  type EmailCategory,
  type EspProvider
} from "./admin-types";
import { defaultBrandAccent, pickBrandAccent, type BrandAccent } from "./brand-accent";
import { buildBrandSummary, type BrandSummary } from "./brand-summary";
import {
  classifyCtaDestination,
  type CtaDestinationKind
} from "./cta-destinations";
import {
  addDaysInZone,
  formatDayKey,
  formatHourOfDay,
  getActiveTimeZone,
  getZonedParts,
  startOfDayInZone,
  startOfWeekInZone,
  startOfYearInZone
} from "./datetime";
import type { ExploreEmailCard } from "./explore-db";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";

/**
 * Top-level shape returned by `getBrandPageData`. Everything the brand
 * dashboard needs is computed server-side so the page can render as a
 * static React tree on the first request — there's no client-side
 * fetching of additional analytics. If a brand's email volume grows past
 * the row cap defined below we'd switch to SQL aggregation, but for the
 * curated set of subscribed competitors the in-memory math is the
 * simpler, faster option.
 */
export type BrandMarketCitation = {
  reasoning: string | null;
  sources: { title: string | null; url: string }[];
};

export type BrandPageData = {
  brand: {
    id: string;
    /** Stable public handle for the brand's `/brands/<slug>` URL. */
    slug: string;
    name: string;
    domain: string | null;
    /**
     * Pretty-cased category labels (e.g. `["Fashion", "Ecommerce"]`) for
     * the brand's markets, sorted in storage order. Empty when the brand
     * is uncategorised. Display-friendly so the dashboard can render the
     * pills without doing its own slug-to-label dance.
     */
    markets: string[];
    /**
     * The brand's rolled-up primary audience country (ISO 3166-1 alpha-2,
     * e.g. "DK"), or `null` when we couldn't confidently tell. Drives the
     * region pill in the hero and, later, same-region peer comparisons.
     */
    primaryMarketCountry: string | null;
    /** Confidence (0–1) of {@link primaryMarketCountry}; `null` when unknown. */
    marketConfidence: number | null;
    /** True for genuine global brands (Nike, LEGO) — they still carry an HQ country. */
    isGlobal: boolean;
    /** Web-resolved HQ country (ISO alpha-2); usually equals primaryMarketCountry. */
    hqCountry: string | null;
    /** Where the market was resolved: "email" rollup or "web" lookup. */
    marketSource: "email" | "web" | null;
    /** Audit payload for a web-resolved market: reasoning + source links. */
    marketCitation: BrandMarketCitation | null;
    logoUrl: string | null;
    subscribedSince: string;
    subscriptionEmail: string | null;
    /**
     * Tabs for the dashboard's list switcher — one per segment we've tagged
     * (i.e. per mailing list we separate out). Each tab is named by the
     * operator's `Label` (the brand's own term, e.g. "Homeware") and
     * `inboxId` scopes the dashboard to that inbox's emails. `categoryLabel`
     * is the prettified category it maps to, shown as a tooltip. The "All"
     * tab is added by the UI. Empty when the brand has no tagged segments,
     * in which case no switcher renders.
     */
    listTabs: {
      key: string;
      label: string;
      inboxId: string;
      categoryLabel: string | null;
    }[];
    /**
     * The inbox id the current view is scoped to, or `null` for the "All"
     * aggregate or a multi-list scope. The brand page uses this to highlight
     * its single active tab.
     */
    activeSegmentId: string | null;
    /**
     * Every inbox the current view is scoped to. Empty = "All lists". A
     * comparison can pin a brand to a subset of its lists (e.g. ARKET's
     * "Men" + "Women"); this is the field the multi-list selector reflects.
     */
    activeSegmentIds: string[];
    /**
     * Auto-derived accent color used to tint the dashboard's stats
     * and graphs (KPI icons, cadence bars, clock heatmap, etc.).
     * Picked from the brand's extracted email palette so each brand
     * page subtly inherits its own visual identity.
     */
    accent: BrandAccent;
  };
  totals: {
    emailCount: number;
    sampleSize: number;
    firstEmailAt: string | null;
    lastEmailAt: string | null;
  };
  cadence: {
    avgDaysBetween: number | null;
    weekly: { weekStart: string; count: number }[];
    typicalDay: { index: number; label: string; share: number } | null;
    typicalHour: { hour: number; label: string; share: number } | null;
    /**
     * Send counts bucketed into all 24 hours of the day, expressed in
     * the platform time zone (Europe/Copenhagen). Index 0 is midnight
     * and index 23 is 11pm. Always 24 entries — zero-send hours are
     * present so the radial heatmap can iterate the array directly
     * without any indexing gymnastics.
     */
    hourly: number[];
    /**
     * Per-day send counts for the last {@link DAILY_TIMELINE_DAYS}
     * days, in chronological order ending today. Every day is present
     * with at least a zero so the compare dashboard's stacked bar
     * chart can render every lookback window without any gap-filling.
     * Drives the 1-week / 1-month / 6-month / 12-month picker in the
     * comparison "send frequency" panel.
     */
    dailyTimeline: { date: string; count: number }[];
  };
  promo: {
    discountEmails: number;
    discountShare: number;
    avgDiscount: number | null;
    maxDiscount: number | null;
    /**
     * `received_at` (ISO) of the email that carried {@link maxDiscount}, so
     * copy can name *when* a brand's steepest offer landed ("…50% off, in
     * November"). `null` when no discounted send exists in the sample.
     */
    maxDiscountAt: string | null;
    /** Count of `sale`-category sends — matches the calendar's "Sale" squares. */
    saleEmails: number;
    /**
     * Share of all sends classified as `sale`. Drives the "Sale frequency"
     * KPI tile; deliberately broader than {@link discountShare} so the tile
     * agrees with the orange Sale cells on the send calendar.
     */
    saleShare: number;
  };
  /**
   * Emoji usage signal computed across the brand's recent subject lines
   * and preheaders. Replaces the old "active promo codes" callout —
   * emoji habits are a stable creative-voice indicator, while the codes
   * list mostly surfaced expired one-off campaigns. `share` is the
   * fraction of recent emails containing at least one emoji,
   * `avgPerEmojiEmail` is the mean count of emoji graphemes inside
   * those emails (so single-emoji users score 1.0 and emoji-heavy
   * brands climb well past that), and `top` is the most-frequent
   * graphemes across the sample.
   */
  emojis: {
    emailsWithEmoji: number;
    share: number;
    totalEmojis: number;
    avgPerEmojiEmail: number | null;
    top: { emoji: string; count: number }[];
  };
  categories: { id: string; label: string; count: number }[];
  esp: {
    primary: { id: EspProvider; label: string; share: number } | null;
    distribution: { id: string; label: string; count: number }[];
  };
  design: {
    palette: { hex: string; count: number }[];
    fonts: { family: string; count: number }[];
    gifShare: number;
    darkModeShare: number;
  };
  subjects: {
    avgLength: number | null;
    samples: string[];
  };
  /**
   * The most-used primary call-to-action labels for this brand. We
   * surface this as a tag cloud on the dashboard so the operator can
   * tell at a glance what verbs / phrases the brand leans on
   * ("Shop now", "Discover", "Read more", …). Entries are normalised
   * case-insensitively but presented in their most common casing so
   * branded all-caps CTAs ("SHOP THE SALE") still look like the brand
   * wrote them.
   */
  ctas: { text: string; count: number }[];
  /**
   * Where the brand's primary CTAs point, classified by URL path
   * (products vs collections vs editorial vs homepage). Sorted by
   * count, unclassifiable hrefs skipped. Powers the "CTAs lead to"
   * line on the comparison fingerprint card.
   */
  ctaDestinations: { kind: CtaDestinationKind; count: number }[];
  /**
   * Per-day activity timeline used to render the GitHub-style heatmap
   * on the brand dashboard. `start` and `end` define the contiguous
   * window the grid should cover (the client fills in empty days), and
   * `days` carries one entry per day that actually had a send, with
   * every email's id, subject, category and send timestamp so the
   * client can colour the cell and populate the hover tooltip without
   * a follow-up request.
   */
  calendar: {
    start: string;
    end: string;
    days: {
      date: string;
      emails: {
        id: string;
        subject: string;
        category: string;
        categoryLabel: string;
        receivedAt: string;
      }[];
    }[];
  };
  recentEmails: ExploreEmailCard[];
  /**
   * Lightweight per-email rows for the whole stats sample, shipped so the
   * "Event run-up" card can keyword-match seasonal campaigns (Father's
   * Day, Black Friday, …) and re-compute lead time client-side the instant
   * the user flips between events. Body text isn't needed — seasonal sends
   * name the occasion in the subject or preheader — but we carry the `id`
   * and a few card fields so a marker click can open the same email modal
   * Explore uses (which fetches the full render itself by id). Brand-level
   * fields are passed separately, not repeated per row, to keep this lean
   * even at the row cap.
   */
  seasonalSample: {
    id: string;
    subject: string;
    preheader: string | null;
    receivedAt: string;
    category: string;
    hasGif: boolean;
    hasDarkMode: boolean;
    discountPercent: number | null;
    promoCode: string | null;
  }[];
};

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

/** Hard cap on rows aggregated for stats; brands with more emails than
 *  this still render but the older tail is ignored. Aggregation cost grows
 *  linearly so a generous cap is fine — the tradeoff is JSON payload size. */
const STATS_ROW_CAP = 500;
/** How many recent emails are shown as live thumbnails at the bottom. */
const RECENT_CARD_COUNT = 8;
/** How many weeks of history power the cadence sparkline. */
const WEEKS_IN_CADENCE = 26;
/**
 * Length of the daily-cadence timeline (in days) shipped to the
 * compare dashboard. 365 covers the longest lookback the comparison
 * "send frequency" picker exposes (12 months) while still being
 * negligible JSON weight (a few KB per brand).
 */
const DAILY_TIMELINE_DAYS = 365;

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
  domain: string;
  markets: string[] | null;
  primary_market_country: string | null;
  market_confidence: number | string | null;
  is_global: boolean | null;
  hq_country: string | null;
  market_source: string | null;
  market_citation: unknown;
  subscribed_since: string;
  logo_storage_path: string | null;
  deleted_at: string | null;
  company_inboxes:
    | {
        id: string;
        email_address: string;
        is_primary: boolean;
        segment_label: string | null;
        segment_category: string | null;
        segment_country: string | null;
      }[]
    | null;
  company_email_stats:
    | { email_count: number | null; last_received_at: string | null }
    | { email_count: number | null; last_received_at: string | null }[]
    | null;
};

type EmailRow = {
  id: string;
  subject: string;
  preheader: string | null;
  received_at: string;
  sent_at: string | null;
  category: string;
  subcategory: string | null;
  has_gif: boolean | null;
  has_dark_mode: boolean | null;
  discount_percent: number | string | null;
  promo_code: string | null;
  primary_cta_text: string | null;
  primary_cta_url: string | null;
  esp_provider: string | null;
  metadata: unknown;
};

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Defensively parses the `market_citation` jsonb (written by the web HQ lookup)
 * into a typed shape for the brand page. Returns null for anything malformed so
 * a bad payload can never break rendering.
 */
function parseMarketCitation(value: unknown): BrandMarketCitation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : null;
  const rawSources = Array.isArray(obj.sources) ? obj.sources : [];
  const sources: BrandMarketCitation["sources"] = [];
  for (const item of rawSources) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.url === "string" && entry.url.length > 0) {
      sources.push({
        title: typeof entry.title === "string" ? entry.title : null,
        url: entry.url
      });
    }
  }
  if (!reasoning && sources.length === 0) return null;
  return { reasoning, sources };
}

/**
 * Human label for a segment switcher tab. Prefers the operator's explicit
 * `segment_label`; otherwise composes one from the category and/or country
 * (e.g. "Jewellery", "US", or "Jewellery · US") so a minimally-tagged inbox
 * still reads sensibly.
 */
function segmentDisplayLabel(inbox: {
  segment_label: string | null;
  segment_category: string | null;
  segment_country: string | null;
}): string {
  const explicit = (inbox.segment_label ?? "").trim();
  if (explicit) return explicit;
  const parts: string[] = [];
  if (inbox.segment_category) parts.push(formatMarketLabel(inbox.segment_category));
  if (inbox.segment_country) parts.push(inbox.segment_country);
  return parts.join(" · ") || "Segment";
}

function formatMarketLabel(market: string): string {
  const trimmed = market.trim();
  if (!trimmed) return market;
  return trimmed
    .split(/[\s_-]+/)
    .map((word) =>
      word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/** One selectable mailing list (segment) on a brand, with the category it
 *  maps to. Mirrors {@link BrandPageData.brand.listTabs} but is fetched
 *  standalone so the comparison pickers can offer a list choice before the
 *  brand is even added to a set. */
export type BrandSegment = {
  inboxId: string;
  label: string;
  categoryLabel: string | null;
};

/**
 * Lists the brand's tagged mailing lists (segments) — the same set the
 * brand page's list switcher shows. Only inboxes the operator has tagged
 * (label / category / country) count; single-list brands return `[]` and
 * the comparison UI simply offers no list choice for them.
 */
export async function getBrandSegments(
  supabase: SupabaseClient<Database>,
  companyId: string
): Promise<BrandSegment[]> {
  const { data, error } = await supabase
    .from("company_inboxes")
    .select("id, segment_label, segment_category, segment_country")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data ?? [])
    .filter(
      (inbox) =>
        inbox.segment_label || inbox.segment_category || inbox.segment_country
    )
    .map((inbox) => ({
      inboxId: inbox.id,
      label: segmentDisplayLabel(inbox),
      categoryLabel: inbox.segment_category
        ? formatMarketLabel(inbox.segment_category)
        : null
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Loads a brand's profile + everything we know about its email program.
 *
 * The function does three things in parallel:
 *   1. Read the company row + the materialised `company_email_stats`
 *      counters (these survive even if our row cap below trims older
 *      emails, so total counts stay accurate).
 *   2. Pull up to `STATS_ROW_CAP` of the most recent captured emails for
 *      the company. Everything in `BrandPageData` except `totals` is
 *      derived from this slice.
 *   3. Sign the brand logo storage path in `email-assets` if we have
 *      one — otherwise the UI falls back to a monogram.
 *
 * Returns `null` if the company doesn't exist or has been soft-deleted,
 * so the route can render a 404.
 */
export async function getBrandPageData(
  supabase: SupabaseClient<Database>,
  companyId: string,
  options: {
    /** Single-list scope (brand page list switcher). */
    segmentInboxId?: string | null;
    /**
     * Multi-list scope (comparisons): include emails from any of these
     * inboxes. Takes precedence over `segmentInboxId` when non-empty. An
     * empty / absent list means the brand's full output ("All lists").
     */
    segmentInboxIds?: string[] | null;
  } = {}
): Promise<BrandPageData | null> {
  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select(
      "id, slug, name, domain, markets, primary_market_country, market_confidence, is_global, hq_country, market_source, market_citation, subscribed_since, deleted_at, logo_storage_path, company_inboxes(id, email_address, is_primary, segment_label, segment_category, segment_country), company_email_stats(email_count, last_received_at)"
    )
    .eq("id", companyId)
    .maybeSingle<CompanyRow>();

  if (companyError) throw companyError;
  if (!companyRow || companyRow.deleted_at) return null;

  // Build the segment list from inboxes the operator has actually tagged.
  // An inbox counts as a segment if it carries any of label / category /
  // country; un-tagged inboxes (single-list brands) produce no segments and
  // the switcher stays hidden.
  const inboxRows = companyRow.company_inboxes ?? [];
  const segments = inboxRows
    .filter(
      (inbox) =>
        inbox.segment_label || inbox.segment_category || inbox.segment_country
    )
    .map((inbox) => ({
      id: inbox.id,
      label: segmentDisplayLabel(inbox),
      category: inbox.segment_category ?? null,
      country: inbox.segment_country ?? null,
      emailAddress: inbox.email_address
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Only honour segment scopes that map to a real segment on this brand;
  // anything else falls back to the "All" aggregate. `segmentInboxIds`
  // (multi-list comparisons) wins over `segmentInboxId` (brand-page tab).
  const validSegmentIds = new Set(segments.map((segment) => segment.id));
  const requestedSegmentIds =
    options.segmentInboxIds && options.segmentInboxIds.length > 0
      ? options.segmentInboxIds
      : options.segmentInboxId
        ? [options.segmentInboxId]
        : [];
  const activeSegmentIds = Array.from(
    new Set(requestedSegmentIds.filter((id) => validSegmentIds.has(id)))
  );
  const scoped = activeSegmentIds.length > 0;
  // Legacy single-scope field: only set when exactly one list is active, so
  // the brand page's tab highlight keeps working unchanged.
  const activeSegmentId = activeSegmentIds.length === 1 ? activeSegmentIds[0] : null;

  // One tab per segment we've actually tagged. The tab is named by the
  // operator's Label (the brand's own term, e.g. "Homeware") and scopes the
  // dashboard to that inbox's emails. `categoryLabel` is the prettified
  // version of the category it's mapped to, surfaced as the tab's tooltip so
  // the brand's term stays connected to our taxonomy.
  const listTabs = segments.map((segment) => ({
    key: `segment:${segment.id}`,
    label: segment.label,
    inboxId: segment.id,
    categoryLabel: segment.category ? formatMarketLabel(segment.category) : null
  }));

  let emailsQuery = supabase
    .from("captured_emails")
    .select(
      "id, subject, preheader, received_at, sent_at, category, subcategory, has_gif, has_dark_mode, discount_percent, promo_code, primary_cta_text, primary_cta_url, esp_provider, metadata"
    )
    .eq("company_id", companyId);
  if (scoped) {
    // One or more specific lists: scope to those inboxes. Each list keeps
    // its own copy of an identical multi-list send, so no dedup here.
    emailsQuery = emailsQuery.in("inbox_id", activeSegmentIds);
  } else {
    // The "All" view collapses identical campaign copies (a welcome blast
    // sent once per list) to the canonical row, so the recent-campaign
    // thumbnails and the cadence/volume stats count the send once.
    emailsQuery = emailsQuery.is("duplicate_of", null);
  }
  const { data: emailRowsRaw, error: emailError } = await emailsQuery
    .order("received_at", { ascending: false })
    .limit(STATS_ROW_CAP);

  if (emailError) throw emailError;
  const emailRows: EmailRow[] = (emailRowsRaw ?? []) as EmailRow[];

  const logoPath = companyRow.logo_storage_path ?? null;
  const signed = logoPath
    ? await getSignedAssets([logoPath], { transform: BRAND_LOGO_TRANSFORM })
    : {};
  const logoUrl = logoPath ? signed[logoPath] ?? null : null;

  const stats = relationFirst(companyRow.company_email_stats);
  const inboxes = companyRow.company_inboxes ?? [];
  const primaryInbox =
    inboxes.find((inbox) => inbox.is_primary)?.email_address ??
    inboxes[0]?.email_address ??
    null;

  // The materialised `company_email_stats` counters are company-wide, so
  // they're only the source of truth for the "All" view. When a segment is
  // active we derive the totals from the (capped) segment rows instead.
  const totalsCount = scoped
    ? emailRows.length
    : stats?.email_count ?? emailRows.length;
  const lastReceivedAt = scoped
    ? emailRows[0]?.received_at ?? null
    : stats?.last_received_at ?? emailRows[0]?.received_at ?? null;
  const firstReceivedAt =
    emailRows.length > 0 ? emailRows[emailRows.length - 1].received_at : null;

  const cadence = computeCadence(emailRows);
  const promo = computePromo(emailRows);
  const emojis = computeEmojis(emailRows);
  const categories = computeCategories(emailRows);
  const esp = computeEsp(emailRows);
  const design = computeDesign(emailRows);
  const subjects = computeSubjects(emailRows);
  const ctas = computeCtas(emailRows);
  const ctaDestinations = computeCtaDestinations(emailRows);
  const calendar = computeCalendar(emailRows);
  const seasonalSample = emailRows.map((row) => ({
    id: row.id,
    subject: row.subject,
    preheader: row.preheader ?? null,
    receivedAt: row.received_at,
    category: row.category,
    hasGif: row.has_gif ?? false,
    hasDarkMode: row.has_dark_mode ?? false,
    discountPercent:
      row.discount_percent === null || row.discount_percent === undefined
        ? null
        : Number(row.discount_percent),
    promoCode: row.promo_code ?? null
  }));
  const accent =
    design.palette.length > 0
      ? pickBrandAccent(design.palette)
      : defaultBrandAccent();
  const rawMarkets = Array.isArray(companyRow.markets) ? companyRow.markets : [];
  const recentEmails = mapRecentEmails(
    emailRows.slice(0, RECENT_CARD_COUNT),
    {
      companyId: companyRow.id,
      companySlug: companyRow.slug,
      companyName: companyRow.name,
      companyDomain: companyRow.domain,
      companyMarkets: rawMarkets,
      companyLogoUrl: logoUrl
    }
  );

  return {
    brand: {
      id: companyRow.id,
      slug: companyRow.slug,
      name: companyRow.name,
      domain: companyRow.domain,
      markets: rawMarkets.map(formatMarketLabel),
      primaryMarketCountry: companyRow.primary_market_country ?? null,
      marketConfidence:
        companyRow.market_confidence === null || companyRow.market_confidence === undefined
          ? null
          : Number(companyRow.market_confidence),
      isGlobal: companyRow.is_global ?? false,
      hqCountry: companyRow.hq_country ?? null,
      marketSource:
        companyRow.market_source === "email" || companyRow.market_source === "web"
          ? companyRow.market_source
          : null,
      marketCitation: parseMarketCitation(companyRow.market_citation),
      logoUrl,
      subscribedSince: companyRow.subscribed_since,
      subscriptionEmail: primaryInbox,
      listTabs,
      activeSegmentId,
      activeSegmentIds,
      accent
    },
    totals: {
      emailCount: totalsCount,
      sampleSize: emailRows.length,
      firstEmailAt: firstReceivedAt,
      lastEmailAt: lastReceivedAt
    },
    cadence,
    promo,
    emojis,
    categories,
    esp,
    design,
    subjects,
    ctas,
    ctaDestinations,
    calendar,
    recentEmails,
    seasonalSample
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a `/brands/<handle>` path segment — which may be either a slug
 * (`sephora`) or a raw UUID (legacy / internal links) — to the canonical
 * company identity. Returns `null` for unknown or soft-deleted brands so the
 * route can 404. The UUID shape is detected up front because passing a slug
 * to a `uuid` column would be a Postgres cast error, not a clean miss.
 */
export async function resolveBrandHandle(
  supabase: SupabaseClient<Database>,
  handle: string
): Promise<{ id: string; slug: string; name: string } | null> {
  const column = UUID_RE.test(handle) ? "id" : "slug";
  const { data, error } = await supabase
    .from("companies")
    .select("id, slug, name, deleted_at")
    .eq(column, handle)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at) return null;
  return { id: data.id, slug: data.slug, name: data.name };
}

/**
 * Lightweight sibling of {@link getBrandPageData} for the *public* brand page.
 * Logged-out / unpaid visitors (and crawlers) get a one-paragraph,
 * data-driven summary without paying for the full analytics payload: this
 * pulls only the three columns the prose needs plus the materialised total,
 * then reuses the same cadence / category / promo math.
 *
 * Returns `null` when there's nothing worth saying (no captured emails, or
 * not enough signal for a cadence or mix), so the page can simply omit the
 * blurb rather than render a thin, boilerplate paragraph.
 */
export async function getBrandSummary(
  supabase: SupabaseClient<Database>,
  companyId: string,
  options: { name: string }
): Promise<BrandSummary | null> {
  const [emailsResult, statsResult] = await Promise.all([
    supabase
      .from("captured_emails")
      .select("received_at, category, discount_percent")
      .eq("company_id", companyId)
      .is("duplicate_of", null)
      .order("received_at", { ascending: false })
      .limit(STATS_ROW_CAP),
    supabase
      .from("companies")
      .select("company_email_stats(email_count)")
      .eq("id", companyId)
      .maybeSingle()
  ]);

  if (emailsResult.error) throw emailsResult.error;
  const rows = (emailsResult.data ?? []) as Pick<
    EmailRow,
    "received_at" | "category" | "discount_percent"
  >[];
  if (rows.length === 0) return null;

  // Stats errors are non-fatal — we just fall back to the (capped) sample
  // size for the headline count rather than failing the whole summary.
  const stats = relationFirst(
    (statsResult.data?.company_email_stats ?? null) as
      | { email_count: number | null }
      | { email_count: number | null }[]
      | null
  );
  const emailCount = stats?.email_count ?? rows.length;

  const cadence = computeCadence(rows);
  const categories = computeCategories(rows);
  const promo = computePromo(rows);

  // Only campaign categories describe "what they send" — transactional /
  // lifecycle mail (incl. our own welcome burst) isn't part of the program.
  const topCategories = categories
    .filter((c) => !NON_CAMPAIGN_CATEGORIES.has(c.id as EmailCategory))
    .slice(0, 2)
    .map((c) => ({ label: c.label, count: c.count }));

  return buildBrandSummary({
    name: options.name,
    emailCount,
    avgDaysBetween: cadence.avgDaysBetween,
    typicalDay: cadence.typicalDay
      ? { label: cadence.typicalDay.label, share: cadence.typicalDay.share }
      : null,
    topCategories,
    maxDiscount: promo.maxDiscount,
    maxDiscountAt: promo.maxDiscountAt
  });
}

/**
 * Tallies the classified destinations of every primary CTA in the
 * sample. Unclassifiable hrefs (missing, mailto:, malformed) are
 * skipped entirely so the shares reflect real web destinations.
 */
function computeCtaDestinations(
  rows: EmailRow[]
): BrandPageData["ctaDestinations"] {
  const counts = new Map<CtaDestinationKind, number>();
  for (const row of rows) {
    const kind = classifyCtaDestination(row.primary_cta_url);
    if (!kind) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

function computeCalendar(rows: EmailRow[]): BrandPageData["calendar"] {
  // Anchor the grid to the current calendar year *in the platform
  // zone*: start at January 1 (snapped backward to the Monday of that
  // week so the first column is always a full Mon-Sun strip) and end
  // on today's midnight Copenhagen time. The year-to-date framing
  // matches how readers intuitively think about "what has this brand
  // sent this year" — the first month label on the heatmap is always
  // "Jan", and a 23:30 Copenhagen send the night before lands on the
  // correct day instead of being pushed onto tomorrow's UTC bucket.
  const zone = getActiveTimeZone();
  const now = new Date();
  const todayStart = startOfDayInZone(now, zone);
  const yearStart = startOfYearInZone(now, zone);
  const startRaw = startOfWeekInZone(yearStart, zone);

  const startISO = formatDayKey(startRaw, zone);
  const endISO = formatDayKey(todayStart, zone);
  const startMs = startRaw.getTime();
  // `todayStart` is the first instant of "today" in Copenhagen; the
  // last instant of "today" is one day later minus 1ms.
  const endMs = addDaysInZone(todayStart, 1, zone).getTime() - 1;

  // Bucket per Copenhagen calendar day. Using `formatDayKey(zone)`
  // keeps the keys deterministic across hosts (UTC servers, dev
  // laptops, etc.) while still respecting the platform zone for
  // boundary placement.
  const byDay = new Map<
    string,
    BrandPageData["calendar"]["days"][number]["emails"]
  >();

  for (const row of rows) {
    const ts = new Date(row.received_at);
    const t = ts.getTime();
    if (Number.isNaN(t) || t < startMs || t > endMs) continue;
    const key = formatDayKey(ts, zone);
    const list = byDay.get(key) ?? [];
    const cat = row.category || "other";
    list.push({
      id: row.id,
      subject: row.subject,
      category: cat,
      categoryLabel:
        EMAIL_CATEGORY_LABELS[cat as EmailCategory] ??
        formatMarketLabel(cat),
      receivedAt: row.received_at
    });
    byDay.set(key, list);
  }

  // Sort each day's emails chronologically. The brand dashboard tooltip
  // stacks earliest-on-top, latest-at-bottom so the user's mental
  // model of "first email of the day, then the next one" matches the
  // popup reading order.
  const days: BrandPageData["calendar"]["days"] = [];
  for (const [date, emails] of byDay) {
    emails.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    days.push({ date, emails });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  return { start: startISO, end: endISO, days };
}

function computeCadence(
  rows: Pick<EmailRow, "received_at" | "category">[]
): BrandPageData["cadence"] {
  // The very first email a brand ever sends us is the signup/welcome mail
  // our own subscription triggers — it lands at whatever moment we happened
  // to join, so its timestamp reflects our signup, not the brand's send
  // schedule. Drop that earliest capture before any rhythm math. Welcome
  // mail the classifier tagged `welcome` is already excluded below by
  // category; dropping the earliest row additionally catches onboarding mail
  // misfiled as `sale` (e.g. a "10% off your first order" signup blast).
  let earliestIdx = -1;
  let earliestTime = Infinity;
  rows.forEach((row, i) => {
    const t = new Date(row.received_at).getTime();
    if (!Number.isNaN(t) && t < earliestTime) {
      earliestTime = t;
      earliestIdx = i;
    }
  });
  const rowsAfterSignup =
    earliestIdx === -1 ? rows : rows.filter((_, i) => i !== earliestIdx);

  // Cadence describes a brand's *broadcast* rhythm, so triggered/lifecycle
  // mail is left out: the welcome series our own subscription fires lands as a
  // burst on the day we joined, which would otherwise inflate send frequency
  // and skew the typical day/hour. Same exclusion the campaign-mix and
  // quiet-zones views use.
  const campaignRows = rowsAfterSignup.filter(
    (row) => !NON_CAMPAIGN_CATEGORIES.has(row.category as EmailCategory)
  );

  // Walk the rows in chronological order so consecutive-send deltas and
  // weekly bucketing are both straightforward.
  const dates = campaignRows
    .map((row) => new Date(row.received_at))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  // Average days between sends — use the median-resistant mean for now,
  // an arithmetic average is good enough at the volumes we see and easier
  // for users to reason about ("about 4 days between emails").
  let avgDaysBetween: number | null = null;
  if (dates.length >= 2) {
    let total = 0;
    for (let i = 1; i < dates.length; i++) {
      total += dates[i].getTime() - dates[i - 1].getTime();
    }
    const meanMs = total / (dates.length - 1);
    avgDaysBetween = meanMs / (1000 * 60 * 60 * 24);
  }

  // Bucket emails into the last `WEEKS_IN_CADENCE` weeks anchored on
  // the platform zone's Monday boundary. We iterate backward from
  // "this week" so the chart's right edge is always today; using
  // `addDaysInZone` (rather than ms-arithmetic) keeps the boundary at
  // local midnight even when a DST transition falls inside the window.
  const zone = getActiveTimeZone();
  const now = new Date();
  const buckets: { weekStart: string; count: number }[] = [];
  const thisWeekStart = startOfWeekInZone(now, zone);

  const weekStartTimes: number[] = [];
  for (let i = WEEKS_IN_CADENCE - 1; i >= 0; i--) {
    const weekStart = addDaysInZone(thisWeekStart, -i * 7, zone);
    buckets.push({ weekStart: weekStart.toISOString(), count: 0 });
    weekStartTimes.push(weekStart.getTime());
  }

  for (const date of dates) {
    const t = date.getTime();
    // Find the bucket: latest weekStart <= t. Linear scan is fine for 26
    // buckets; a binary search is overkill.
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= weekStartTimes[i]) {
        buckets[i].count += 1;
        break;
      }
    }
  }

  // Day-of-week / hour-of-day mode in the platform zone. Reads as
  // "they almost always send on Tuesday" / "around 9am CEST". We
  // surface the share so the UI can dim the value when the signal is
  // weak (e.g. 18% across 7 days = no pattern).
  const dayCounts = new Array(7).fill(0);
  const hourCounts = new Array(24).fill(0);
  for (const date of dates) {
    const parts = getZonedParts(date, zone);
    dayCounts[parts.weekday] += 1;
    hourCounts[parts.hour] += 1;
  }

  let typicalDay: BrandPageData["cadence"]["typicalDay"] = null;
  if (dates.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < dayCounts.length; i++) {
      if (dayCounts[i] > dayCounts[bestIdx]) bestIdx = i;
    }
    // Only report a typical day when one weekday is a *unique* maximum.
    // At our per-brand sample sizes several weekdays often tie for the
    // lead, and the strict-`>` scan above would always award that tie to
    // Sunday (index 0) — manufacturing a "Mostly Sundays" that's really
    // "no particular day". A tie means there's no typical day to claim.
    const isUniqueMax =
      dayCounts.filter((c) => c === dayCounts[bestIdx]).length === 1;
    if (isUniqueMax) {
      typicalDay = {
        index: bestIdx,
        label: DAY_LABELS[bestIdx],
        share: dayCounts[bestIdx] / dates.length
      };
    }
  }

  let typicalHour: BrandPageData["cadence"]["typicalHour"] = null;
  if (dates.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < hourCounts.length; i++) {
      if (hourCounts[i] > hourCounts[bestIdx]) bestIdx = i;
    }
    typicalHour = {
      hour: bestIdx,
      label: formatHourOfDay(bestIdx, {
        case: "lower",
        withZone: true,
        zone,
        referenceInstant: now
      }),
      share: hourCounts[bestIdx] / dates.length
    };
  }

  // Daily timeline for the compare dashboard. We initialise every day
  // in the lookback window so the chart can iterate a fixed-length
  // array (no gap-filling on the client) and so the user always sees
  // visible empty days rather than the chart collapsing.
  const todayStartDaily = startOfDayInZone(now, zone);
  const dailyTimeline: { date: string; count: number }[] = [];
  const dailyStartMs: number[] = [];
  for (let i = DAILY_TIMELINE_DAYS - 1; i >= 0; i--) {
    const dayStart = addDaysInZone(todayStartDaily, -i, zone);
    dailyTimeline.push({
      date: formatDayKey(dayStart, zone),
      count: 0
    });
    dailyStartMs.push(dayStart.getTime());
  }
  const dailyEndMs =
    addDaysInZone(todayStartDaily, 1, zone).getTime() - 1;
  for (const date of dates) {
    const t = date.getTime();
    if (t < dailyStartMs[0] || t > dailyEndMs) continue;
    // Binary search the bucket whose [start, start+1d) range contains t.
    // Linear scan would be fine for 365 entries × a few hundred dates,
    // but the binary search keeps this O(n log m) so we stay snappy
    // even when STATS_ROW_CAP grows.
    let lo = 0;
    let hi = dailyStartMs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (dailyStartMs[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    dailyTimeline[lo].count += 1;
  }

  return {
    avgDaysBetween,
    weekly: buckets,
    typicalDay,
    typicalHour,
    hourly: hourCounts,
    dailyTimeline
  };
}

function computePromo(
  rows: Pick<EmailRow, "discount_percent" | "received_at" | "category">[]
): BrandPageData["promo"] {
  let discountEmails = 0;
  let discountSum = 0;
  let discountMax: number | null = null;
  let discountMaxAt: string | null = null;
  let saleEmails = 0;

  for (const row of rows) {
    // Sale frequency mirrors the orange "Sale" squares on the send calendar:
    // it counts the keyword-classified `sale` category, which fires on sale
    // *language* ("Sale now on", "Final reductions") even when no explicit
    // "% off" is present. This is intentionally broader than `discountEmails`
    // below, which only counts emails where the vision model read a numeric
    // discount off the creative.
    if (row.category === "sale") {
      saleEmails += 1;
    }

    const dp =
      row.discount_percent === null || row.discount_percent === undefined
        ? null
        : Number(row.discount_percent);
    if (dp !== null && Number.isFinite(dp)) {
      discountEmails += 1;
      discountSum += dp;
      // Strictly-greater so the *first* (most recent, since rows arrive
      // newest-first) email at the peak discount wins the timestamp — ties
      // shouldn't drag the "when" back to an older identical offer.
      if (discountMax === null || dp > discountMax) {
        discountMax = dp;
        discountMaxAt = row.received_at;
      }
    }
  }

  return {
    discountEmails,
    discountShare: rows.length > 0 ? discountEmails / rows.length : 0,
    avgDiscount: discountEmails > 0 ? discountSum / discountEmails : null,
    maxDiscount: discountMax,
    maxDiscountAt: discountMaxAt,
    saleEmails,
    saleShare: rows.length > 0 ? saleEmails / rows.length : 0
  };
}

/**
 * Per-grapheme emoji frequency across the brand's subject lines and
 * preheaders. We split each headline into grapheme clusters with
 * `Intl.Segmenter` so multi-codepoint sequences (skin tone modifiers,
 * ZWJ family glyphs, regional indicators) bucket as a single emoji
 * instead of fragmenting into surrogate halves — that matters because
 * brands love compound flags / hearts and we don't want "❤️" and
 * "🇩🇰" splintering into noise.
 *
 * Picks `\p{Extended_Pictographic}` over `\p{Emoji}` because the
 * latter also matches plain digits and the `#` / `*` keycaps, which
 * would let "Save 20% off" register as an "emoji email".
 */
function computeEmojis(rows: EmailRow[]): BrandPageData["emojis"] {
  if (rows.length === 0) {
    return {
      emailsWithEmoji: 0,
      share: 0,
      totalEmojis: 0,
      avgPerEmojiEmail: null,
      top: []
    };
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const pictographic = /\p{Extended_Pictographic}/u;
  // Variation selector (U+FE0F) and zero-width joiner can hang on the
  // tail of an emoji sequence after segmentation in edge cases; strip
  // any trailing combiners before we use the cluster as a Map key so
  // visually identical glyphs don't end up in two separate buckets.
  const trailingFormatters = /[\uFE0F\u200D]+$/g;

  const counts = new Map<string, number>();
  let emailsWithEmoji = 0;
  let totalEmojis = 0;

  for (const row of rows) {
    const subject = row.subject ?? "";
    const preheader = row.preheader ?? "";
    const text = `${subject} ${preheader}`;
    if (!text.trim()) continue;

    let perEmail = 0;
    for (const seg of segmenter.segment(text)) {
      const grapheme = seg.segment;
      if (!pictographic.test(grapheme)) continue;
      const key = grapheme.replace(trailingFormatters, "") || grapheme;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      perEmail += 1;
    }
    if (perEmail > 0) {
      emailsWithEmoji += 1;
      totalEmojis += perEmail;
    }
  }

  const top = Array.from(counts.entries())
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
    .slice(0, 8);

  return {
    emailsWithEmoji,
    share: rows.length > 0 ? emailsWithEmoji / rows.length : 0,
    totalEmojis,
    avgPerEmojiEmail:
      emailsWithEmoji > 0 ? totalEmojis / emailsWithEmoji : null,
    top
  };
}

function computeCategories(
  rows: Pick<EmailRow, "category">[]
): BrandPageData["categories"] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const cat = row.category || "other";
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({
      id,
      label:
        EMAIL_CATEGORY_LABELS[id as EmailCategory] ??
        formatMarketLabel(id),
      count
    }))
    .sort((a, b) => b.count - a.count);
}

function computeEsp(rows: EmailRow[]): BrandPageData["esp"] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.esp_provider) {
      counts.set(row.esp_provider, (counts.get(row.esp_provider) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return { primary: null, distribution: [] };
  }
  const distribution = Array.from(counts.entries())
    .map(([id, count]) => ({
      id,
      label: ESP_LABELS[id as EspProvider] ?? formatMarketLabel(id),
      count
    }))
    .sort((a, b) => b.count - a.count);

  const top = distribution[0];
  return {
    primary: {
      id: top.id as EspProvider,
      label: top.label,
      share: rows.length > 0 ? top.count / rows.length : 0
    },
    distribution
  };
}

function computeDesign(rows: EmailRow[]): BrandPageData["design"] {
  const palette = new Map<string, number>();
  const fonts = new Map<string, number>();
  let gif = 0;
  let dark = 0;

  for (const row of rows) {
    if (row.has_gif) gif += 1;
    if (row.has_dark_mode) dark += 1;

    const meta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null;

    if (meta) {
      // Prefer the pixel-extracted brand palette when present; fall back to the
      // HTML-token palette for emails that haven't been (re)processed.
      const imgPalette = meta.image_palette;
      const colors =
        Array.isArray(imgPalette) && imgPalette.length > 0 ? imgPalette : meta.palette_colors;
      if (Array.isArray(colors)) {
        for (const item of colors) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const entry = item as Record<string, unknown>;
            const hex =
              typeof entry.hex === "string" ? entry.hex.toLowerCase() : null;
            if (hex && /^#[0-9a-f]{6}$/.test(hex)) {
              // Weight by the color's *within-email* occurrence count
              // rather than "+1 vote per email it appears in". Otherwise a
              // single transactional/confirmation send (Mailchimp-default
              // greens and blues) outranks the actual brand colors that
              // dominate every campaign — that's what was pushing Eva
              // Solo's `#004cff` and `#b6d7a8` into the top 10 even
              // though their share of the rendered surface is tiny.
              const raw = entry.count;
              const within =
                typeof raw === "number" && Number.isFinite(raw) && raw > 0
                  ? Math.floor(raw)
                  : 1;
              palette.set(hex, (palette.get(hex) ?? 0) + within);
            }
          }
        }
      }
      const fontList = meta.font_families;
      if (Array.isArray(fontList)) {
        for (const item of fontList) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const entry = item as Record<string, unknown>;
            const family =
              typeof entry.family === "string" ? entry.family.trim() : "";
            const primaryCount =
              typeof entry.primary_count === "number" &&
              Number.isFinite(entry.primary_count)
                ? Math.max(0, Math.floor(entry.primary_count))
                : 0;
            if (family && primaryCount > 0) {
              fonts.set(family, (fonts.get(family) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  return {
    palette: Array.from(palette.entries())
      .map(([hex, count]) => ({ hex, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    fonts: Array.from(fonts.entries())
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4),
    gifShare: rows.length > 0 ? gif / rows.length : 0,
    darkModeShare: rows.length > 0 ? dark / rows.length : 0
  };
}

function computeSubjects(rows: EmailRow[]): BrandPageData["subjects"] {
  if (rows.length === 0) {
    return { avgLength: null, samples: [] };
  }
  let total = 0;
  let counted = 0;
  const seen = new Set<string>();
  const samples: string[] = [];
  for (const row of rows) {
    const subject = (row.subject ?? "").trim();
    if (subject) {
      total += subject.length;
      counted += 1;
      // Dedupe per-brand for the "Recent subjects" callout — many brands
      // resend the same subject across A/B sends so the raw list is
      // boring without a normalised dedupe.
      const key = subject.toLowerCase();
      if (!seen.has(key) && samples.length < 5) {
        seen.add(key);
        samples.push(subject);
      }
    }
  }

  return {
    avgLength: counted > 0 ? total / counted : null,
    samples
  };
}

/**
 * Aggregates the brand's most-used primary CTA labels into a frequency
 * list suitable for a tag cloud.
 *
 * Normalisation rules — chosen to behave well on real data without
 * being clever enough to surprise:
 *   - Trim and collapse internal whitespace so "Shop  now" and
 *     "Shop now " bucket together.
 *   - Group case-insensitively (key = lowercase) so "Shop now" and
 *     "SHOP NOW" don't fight each other in the cloud.
 *   - Within a bucket, display the *most-seen* original casing so a
 *     brand that writes its CTAs in all-caps still reads as all-caps.
 *   - Drop anything longer than 60 chars — long sentences are almost
 *     always either accidental headlines or marketing copy mis-tagged
 *     as the CTA, and they wreck the tag cloud's layout.
 *   - Cap the cloud at 30 tags so visual weight stays readable; the
 *     long tail is more noise than signal anyway.
 */
function computeCtas(rows: EmailRow[]): BrandPageData["ctas"] {
  type Bucket = { count: number; variants: Map<string, number> };
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const raw = (row.primary_cta_text ?? "").replace(/\s+/g, " ").trim();
    if (!raw || raw.length > 60) continue;
    const key = raw.toLowerCase();
    const bucket = buckets.get(key) ?? {
      count: 0,
      variants: new Map<string, number>()
    };
    bucket.count += 1;
    bucket.variants.set(raw, (bucket.variants.get(raw) ?? 0) + 1);
    buckets.set(key, bucket);
  }

  const entries: BrandPageData["ctas"] = [];
  for (const bucket of buckets.values()) {
    let bestText = "";
    let bestCount = -1;
    for (const [variant, count] of bucket.variants) {
      if (count > bestCount) {
        bestCount = count;
        bestText = variant;
      }
    }
    entries.push({ text: bestText, count: bucket.count });
  }

  entries.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return entries.slice(0, 30);
}

function mapRecentEmails(
  rows: EmailRow[],
  brand: {
    companyId: string;
    companySlug: string;
    companyName: string;
    companyDomain: string | null;
    companyMarkets: string[];
    companyLogoUrl: string | null;
  }
): ExploreEmailCard[] {
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    preheader: row.preheader ?? null,
    companyId: brand.companyId,
    companySlug: brand.companySlug,
    companyName: brand.companyName,
    companyDomain: brand.companyDomain,
    companyMarkets: brand.companyMarkets,
    companyLogoUrl: brand.companyLogoUrl,
    receivedAt: row.received_at,
    category: row.category,
    hasGif: row.has_gif ?? false,
    hasDarkMode: row.has_dark_mode ?? false,
    discountPercent:
      row.discount_percent === null || row.discount_percent === undefined
        ? null
        : Number(row.discount_percent),
    promoCode: row.promo_code ?? null
  }));
}
