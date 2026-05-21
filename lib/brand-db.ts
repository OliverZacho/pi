import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_CATEGORY_LABELS,
  ESP_LABELS,
  type EmailCategory,
  type EspProvider
} from "./admin-types";
import { defaultBrandAccent, pickBrandAccent, type BrandAccent } from "./brand-accent";
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
import { getSignedAssets } from "./storage";
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
export type BrandPageData = {
  brand: {
    id: string;
    name: string;
    domain: string | null;
    market: string | null;
    logoUrl: string | null;
    subscribedSince: string;
    subscriptionEmail: string | null;
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
    promoCodes: { code: string; count: number }[];
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
  name: string;
  domain: string;
  market: string | null;
  subscribed_since: string;
  logo_storage_path: string | null;
  deleted_at: string | null;
  company_inboxes:
    | { email_address: string; is_primary: boolean }[]
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
  esp_provider: string | null;
  metadata: unknown;
};

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
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
  companyId: string
): Promise<BrandPageData | null> {
  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select(
      "id, name, domain, market, subscribed_since, deleted_at, logo_storage_path, company_inboxes(email_address, is_primary), company_email_stats(email_count, last_received_at)"
    )
    .eq("id", companyId)
    .maybeSingle<CompanyRow>();

  if (companyError) throw companyError;
  if (!companyRow || companyRow.deleted_at) return null;

  const { data: emailRowsRaw, error: emailError } = await supabase
    .from("captured_emails")
    .select(
      "id, subject, preheader, received_at, sent_at, category, subcategory, has_gif, has_dark_mode, discount_percent, promo_code, primary_cta_text, esp_provider, metadata"
    )
    .eq("company_id", companyId)
    .order("received_at", { ascending: false })
    .limit(STATS_ROW_CAP);

  if (emailError) throw emailError;
  const emailRows: EmailRow[] = (emailRowsRaw ?? []) as EmailRow[];

  const logoPath = companyRow.logo_storage_path ?? null;
  const signed = logoPath ? await getSignedAssets([logoPath]) : {};
  const logoUrl = logoPath ? signed[logoPath] ?? null : null;

  const stats = relationFirst(companyRow.company_email_stats);
  const inboxes = companyRow.company_inboxes ?? [];
  const primaryInbox =
    inboxes.find((inbox) => inbox.is_primary)?.email_address ??
    inboxes[0]?.email_address ??
    null;

  const totalsCount = stats?.email_count ?? emailRows.length;
  const lastReceivedAt =
    stats?.last_received_at ?? emailRows[0]?.received_at ?? null;
  const firstReceivedAt =
    emailRows.length > 0 ? emailRows[emailRows.length - 1].received_at : null;

  const cadence = computeCadence(emailRows);
  const promo = computePromo(emailRows);
  const categories = computeCategories(emailRows);
  const esp = computeEsp(emailRows);
  const design = computeDesign(emailRows);
  const subjects = computeSubjects(emailRows);
  const ctas = computeCtas(emailRows);
  const calendar = computeCalendar(emailRows);
  const accent =
    design.palette.length > 0
      ? pickBrandAccent(design.palette)
      : defaultBrandAccent();
  const recentEmails = mapRecentEmails(
    emailRows.slice(0, RECENT_CARD_COUNT),
    {
      companyId: companyRow.id,
      companyName: companyRow.name,
      companyDomain: companyRow.domain,
      companyMarket: companyRow.market,
      companyLogoUrl: logoUrl
    }
  );

  return {
    brand: {
      id: companyRow.id,
      name: companyRow.name,
      domain: companyRow.domain,
      market: companyRow.market
        ? formatMarketLabel(companyRow.market)
        : null,
      logoUrl,
      subscribedSince: companyRow.subscribed_since,
      subscriptionEmail: primaryInbox,
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
    categories,
    esp,
    design,
    subjects,
    ctas,
    calendar,
    recentEmails
  };
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

function computeCadence(rows: EmailRow[]): BrandPageData["cadence"] {
  // Walk the rows in chronological order so consecutive-send deltas and
  // weekly bucketing are both straightforward.
  const dates = rows
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
    typicalDay = {
      index: bestIdx,
      label: DAY_LABELS[bestIdx],
      share: dayCounts[bestIdx] / dates.length
    };
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

function computePromo(rows: EmailRow[]): BrandPageData["promo"] {
  let discountEmails = 0;
  let discountSum = 0;
  let discountMax: number | null = null;
  const codeCounts = new Map<string, number>();

  for (const row of rows) {
    const dp =
      row.discount_percent === null || row.discount_percent === undefined
        ? null
        : Number(row.discount_percent);
    if (dp !== null && Number.isFinite(dp)) {
      discountEmails += 1;
      discountSum += dp;
      if (discountMax === null || dp > discountMax) {
        discountMax = dp;
      }
    }
    if (row.promo_code) {
      const code = row.promo_code.trim();
      if (code) {
        codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
      }
    }
  }

  const promoCodes = Array.from(codeCounts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 6);

  return {
    discountEmails,
    discountShare: rows.length > 0 ? discountEmails / rows.length : 0,
    avgDiscount: discountEmails > 0 ? discountSum / discountEmails : null,
    maxDiscount: discountMax,
    promoCodes
  };
}

function computeCategories(rows: EmailRow[]): BrandPageData["categories"] {
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
      const colors = meta.palette_colors;
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
    companyName: string;
    companyDomain: string | null;
    companyMarket: string | null;
    companyLogoUrl: string | null;
  }
): ExploreEmailCard[] {
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    preheader: row.preheader ?? null,
    companyId: brand.companyId,
    companyName: brand.companyName,
    companyDomain: brand.companyDomain,
    companyMarket: brand.companyMarket,
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
