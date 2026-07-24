import type { BrandPageData } from "./brand-db";
import {
  classifyListHeaders,
  NON_CAMPAIGN_CATEGORIES,
  type EmailCategory,
  type ListHeaders
} from "./admin-types";
import type { AuthResults } from "./extract-metadata";
import {
  QUIET_ZONE_DAYPARTS,
  QUIET_ZONE_DAYS,
  urgencyShare,
  weeklySendRate
} from "./comparison-insights";
import { getZonedParts } from "./datetime";
import {
  analyzeSeasonalRunup,
  SEASONAL_EVENTS,
  type SeasonalEmailInput
} from "./seasonal-events";
import { detectOpenPixel } from "./tracking-pixels";

/**
 * Rule engine behind the "Your brand" tab: the user's login-email domain
 * matched a tracked brand, and this module turns that brand's captured
 * data into a short list of things they could consider changing about
 * their own email program.
 *
 * Design contract, shared with `comparison-insights.ts`: every rule is a
 * pure function over already-computed data, applies a minimum-sample and
 * minimum-interestingness threshold, and returns `null` rather than a
 * hollow finding. The page therefore only ever shows insights that are
 * genuinely actionable, which is what makes the tab worth opening.
 *
 * Rule ids are load-bearing: they are the keys users dismiss insights
 * under (stored in `user_prefs`), so renaming one silently resurrects
 * every dismissal of it. Add new ids freely, never repurpose old ones.
 */

export const YOUR_BRAND_INSIGHT_IDS = [
  "preview-text-missing",
  "preview-text-padding",
  "heavy-emails",
  "no-dark-mode",
  "long-subjects",
  "sale-heavy-mix",
  "deadline-extensions",
  "discount-creep",
  "unsubscribe-headers",
  "auth-failures",
  "cadence-low",
  "cadence-high",
  "send-time-collision",
  "urgency-overuse",
  "tracking-pixel-consent",
  "no-welcome-flow",
  "missing-alt-text",
  "bursty-cadence",
  "evergreen-promo-code",
  "subject-repetition",
  "discount-frequency-peers",
  "seasonal-late-start"
] as const;

export type YourBrandInsightId = (typeof YOUR_BRAND_INSIGHT_IDS)[number];

const KNOWN_INSIGHT_IDS = new Set<string>(YOUR_BRAND_INSIGHT_IDS);

export function isYourBrandInsightId(
  value: unknown
): value is YourBrandInsightId {
  return typeof value === "string" && KNOWN_INSIGHT_IDS.has(value);
}

export type YourBrandInsight = {
  id: YourBrandInsightId;
  /**
   * `fix` = objectively hurting them today (deliverability, rendering);
   * `consider` = a strategic trade-off worth a decision. Only affects
   * presentation, both kinds are dismissible.
   */
  kind: "fix" | "consider";
  title: string;
  body: string;
  /** Optional Learn article that explains the mechanism. */
  learnHref: string | null;
  /** Link text for {@link learnHref} — should name the destination. */
  learnLabel?: string;
  /** True when the finding compares against the user's competitor set. */
  usesPeers: boolean;
};

/**
 * One header-level signal per sampled email, fetched separately from
 * `BrandPageData` because the brand dashboard never needed raw headers.
 * `null` fields mean the row predates capture, and are excluded from
 * every denominator.
 */
export type DeliverabilitySignal = {
  listHeaders: ListHeaders | null;
  authResults: AuthResults | null;
};

/**
 * Alt-text coverage for one sampled email, computed at read time from
 * `html_content` (see `getAltTextSample` in lib/your-brand-db.ts) — the
 * same fetch-a-small-raw-sample pattern the header rules use. Tracking
 * pixels and 1px spacers are excluded from `contentImages`.
 */
export type AltTextSignal = {
  contentImages: number;
  withAlt: number;
};

/**
 * All-time welcome evidence for the brand. A separate query rather than
 * `BrandPageData.categories` because the stats sample is capped at the
 * most recent rows — for any active brand the welcome email is the
 * *oldest* row and ages out of the sample, which would make a
 * sample-based "no welcome" claim wrong exactly for the brands with the
 * most data.
 */
export type WelcomeSignal = {
  /** Welcome-category emails ever captured, duplicates included. */
  welcomeCount: number;
};

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

/** Below this many sampled emails, self-contained rules stay silent. */
const MIN_SAMPLE = 10;
/** Peer rules need a real cohort, not a single rival. */
const MIN_PEERS = 2;
/** Peer timing rules need this many recent campaign sends across the group. */
const MIN_PEER_SENDS = 40;
/** Header rules need this many rows that actually carried headers. */
const MIN_HEADER_SAMPLE = 5;

const MB = 1024 * 1024;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function fmtMb(bytes: number): string {
  const mb = bytes / MB;
  return mb >= 10 ? String(Math.round(mb)) : (Math.round(mb * 10) / 10).toFixed(1);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function isCampaignCategory(category: string): boolean {
  return !NON_CAMPAIGN_CATEGORIES.has(category as EmailCategory);
}

/* ------------------------------------------------------------------ */
/* Self-contained rules                                                */
/* ------------------------------------------------------------------ */

function previewTextRules(own: BrandPageData): YourBrandInsight[] {
  const sample = own.seasonalSample;
  if (sample.length < MIN_SAMPLE) return [];

  const withPreheader = sample.filter(
    (email) => (email.preheader ?? "").trim().length > 0
  ).length;
  const missingShare = 1 - withPreheader / sample.length;

  if (missingShare >= 0.5) {
    return [
      {
        id: "preview-text-missing",
        kind: "fix",
        title: "Most of your emails ship without preview text",
        body: `${pct(missingShare)} of your last ${sample.length} emails had no preview text, so Gmail and Apple Mail fill the space after your subject line with whatever body text comes first. A written preview line is the cheapest open-rate lever there is.`,
        learnHref: null,
        usesPeers: false
      }
    ];
  }

  const padding = own.design.preheaderPadding;
  if (padding.measured >= MIN_SAMPLE && padding.share < 0.4) {
    const lead =
      padding.padded === 0
        ? `None of your last ${padding.measured} emails pad the preview text with invisible characters.`
        : padding.padded === 1
          ? `Only 1 of your last ${padding.measured} emails pads the preview text with invisible characters.`
          : `Only ${padding.padded} of your last ${padding.measured} emails pad the preview text with invisible characters.`;
    return [
      {
        id: "preview-text-padding",
        kind: "fix",
        title: "Your preview text runs into body text",
        body: `${lead} Without the padding, inboxes append your body copy (or an unsubscribe line) right after the preview you wrote.`,
        learnHref: "/learn/preheader-padding-trick",
        learnLabel: "Why padding matters, on the Learn page",
        usesPeers: false
      }
    ];
  }

  return [];
}

/**
 * Calibrated against the catalogue (July 2026): per-brand average image
 * weight has a median of ~2.7 MB and a 90th percentile of ~6.3 MB, so
 * anything past 6 MB is genuinely a heavy sender, not the middle of the
 * pack. Recheck the percentiles if this ever seems to over- or
 * under-fire.
 */
const HEAVY_EMAIL_BYTES = 6 * MB;

function heavyEmailsRule(own: BrandPageData): YourBrandInsight | null {
  const images = own.design.images;
  if (images.emailsMeasured < MIN_SAMPLE) return null;
  if (
    images.avgBytesPerEmail === null ||
    images.avgBytesPerEmail < HEAVY_EMAIL_BYTES
  ) {
    return null;
  }

  // `has_gif` historically meant "any GIF asset, tracking pixels
  // included", which set the flag on every send at many brands and would
  // have made this hint effectively unconditional. Since July 2026 the
  // flag requires a content GIF of meaningful size (MIN_CONTENT_GIF_BYTES
  // in lib/extract-metadata.ts, backfilled), so the share of sends with a
  // GIF is safe to gate on directly.
  const gifNote =
    own.design.gifShare >= 0.2
      ? " GIFs are the usual culprit. A short loop often weighs ten times a static image."
      : "";

  return {
    id: "heavy-emails",
    kind: "fix",
    title: "Your emails are heavy",
    body: `Your recent emails average ${fmtMb(images.avgBytesPerEmail)} MB of images, heavier than roughly nine in ten brands we track. On mobile that means visible loading, and some clients stop fetching altogether. Converting hero images to WebP or AVIF usually cuts the weight by more than half.${gifNote}`,
    learnHref: null,
    usesPeers: false
  };
}

function darkModeRule(
  own: BrandPageData,
  peers: BrandPageData[]
): YourBrandInsight | null {
  if (own.totals.sampleSize < MIN_SAMPLE) return null;
  if (own.design.darkModeShare > 0) return null;

  // Most email programs skip dark mode entirely, so "you don't handle
  // dark mode" alone is a generic tip, not a decision. Only fire when at
  // least half the user's chosen competitors DO handle it — then it's a
  // real gap against their own peer group.
  if (peers.length < MIN_PEERS) return null;
  const peersWithDarkMode = peers.filter(
    (peer) => peer.design.darkModeShare > 0
  ).length;
  if (peersWithDarkMode < peers.length / 2) return null;

  const peerClause =
    peersWithDarkMode === peers.length
      ? `all ${peers.length} brands in your comparison group do`
      : `${peersWithDarkMode} of the ${peers.length} brands in your comparison group do`;

  return {
    id: "no-dark-mode",
    kind: "consider",
    title: "Your competitors handle dark mode",
    body: `None of your recent emails declare dark-mode styles, while ${peerClause}. Roughly a third of inbox time happens in dark mode, where unstyled emails get their colors force-inverted, which is where broken logos and unreadable buttons come from.`,
    learnHref: null,
    usesPeers: true
  };
}

function longSubjectsRule(own: BrandPageData): YourBrandInsight | null {
  const avg = own.subjects.avgLength;
  if (avg === null || own.totals.sampleSize < MIN_SAMPLE) return null;
  if (avg < 55) return null;

  return {
    id: "long-subjects",
    kind: "consider",
    title: "Your subject lines get cut off on mobile",
    body: `Your subject lines average ${Math.round(avg)} characters. Mobile inboxes show roughly 35 to 40 before truncating, so the second half of most of your subjects is never seen. Front-load the point, or shorten.`,
    learnHref: null,
    usesPeers: false
  };
}

function saleHeavyRule(own: BrandPageData): YourBrandInsight | null {
  let campaignTotal = 0;
  let saleCount = 0;
  for (const category of own.categories) {
    if (!isCampaignCategory(category.id)) continue;
    campaignTotal += category.count;
    if (category.id === "sale") saleCount = category.count;
  }
  if (campaignTotal < 20) return null;
  const share = saleCount / campaignTotal;
  if (share < 0.75) return null;

  return {
    id: "sale-heavy-mix",
    kind: "consider",
    title:
      share >= 0.95
        ? "Everything you send is a sale"
        : "Almost everything you send is a sale",
    body: `${pct(share)} of your campaigns are sale emails. When nearly every send asks for a discount purchase, subscribers learn to ignore you between sales. Brands that mix in content, launches or education give people a reason to open at full price too.`,
    learnHref: null,
    usesPeers: false
  };
}

function deadlineExtensionsRule(own: BrandPageData): YourBrandInsight | null {
  const { offersWithDeadline, offersExtended } = own.promo;
  if (offersWithDeadline < 3) return null;
  const share = offersExtended / offersWithDeadline;
  if (share < 0.5) return null;

  return {
    id: "deadline-extensions",
    kind: "consider",
    title: "Your deadlines keep moving",
    // "deadlines you set", not "your last N offers" — the denominator is
    // offers that stated an end date, and offers without one don't count.
    body: `You extended ${offersExtended} of the last ${offersWithDeadline} offer deadlines you set. Extensions convert in the short term, but subscribers who have seen a deadline move stop treating your deadlines as real, and the urgency stops working.`,
    learnHref: null,
    usesPeers: false
  };
}

/** Months (YYYY-MM, ascending) mapped to that month's average stated discount. */
function discountByMonth(own: BrandPageData): { month: string; avg: number }[] {
  const buckets = new Map<string, { total: number; count: number }>();
  for (const email of own.seasonalSample) {
    const percent = email.discountPercent;
    if (percent === null || percent <= 0) continue;
    const month = email.receivedAt.slice(0, 7);
    if (month.length !== 7) continue;
    const bucket = buckets.get(month) ?? { total: 0, count: 0 };
    bucket.total += percent;
    bucket.count += 1;
    buckets.set(month, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, { total, count }]) => ({ month, avg: total / count }));
}

function discountCreepRule(own: BrandPageData): YourBrandInsight | null {
  const months = discountByMonth(own);
  if (months.length < 6) return null;

  const half = Math.floor(months.length / 2);
  const earlier = months.slice(0, half);
  const recent = months.slice(months.length - half);
  const earlierAvg =
    earlier.reduce((sum, m) => sum + m.avg, 0) / earlier.length;
  const recentAvg = recent.reduce((sum, m) => sum + m.avg, 0) / recent.length;
  if (recentAvg - earlierAvg < 7) return null;

  return {
    id: "discount-creep",
    kind: "consider",
    title: "Your discounts are getting deeper",
    body: `Your average stated discount has climbed from ${Math.round(earlierAvg)}% to ${Math.round(recentAvg)}% over the period we track. Deepening discounts train subscribers to wait for the next, bigger sale, and clawing depth back later is much harder than holding the line now.`,
    learnHref: null,
    usesPeers: false
  };
}

/**
 * An offer code that has effectively become permanent. Codes longer than
 * this are skipped as likely per-recipient tokens, not shared campaign
 * codes.
 */
const EVERGREEN_MAX_CODE_LENGTH = 15;
const EVERGREEN_MIN_SENDS = 4;
const EVERGREEN_MIN_SPAN_DAYS = 90;

function evergreenPromoCodeRule(own: BrandPageData): YourBrandInsight | null {
  const byCode = new Map<
    string,
    { count: number; firstMs: number; lastMs: number; display: string }
  >();
  for (const email of own.seasonalSample) {
    if (!isCampaignCategory(email.category)) continue;
    const raw = (email.promoCode ?? "").trim();
    if (!raw || raw.length > EVERGREEN_MAX_CODE_LENGTH) continue;
    const ts = new Date(email.receivedAt).getTime();
    if (Number.isNaN(ts)) continue;
    const key = raw.toUpperCase();
    const entry = byCode.get(key) ?? {
      count: 0,
      firstMs: ts,
      lastMs: ts,
      display: raw.toUpperCase()
    };
    entry.count += 1;
    entry.firstMs = Math.min(entry.firstMs, ts);
    entry.lastMs = Math.max(entry.lastMs, ts);
    byCode.set(key, entry);
  }

  let worst: { display: string; count: number; spanDays: number } | null = null;
  for (const entry of byCode.values()) {
    const spanDays = (entry.lastMs - entry.firstMs) / 86_400_000;
    if (entry.count < EVERGREEN_MIN_SENDS) continue;
    if (spanDays < EVERGREEN_MIN_SPAN_DAYS) continue;
    if (!worst || spanDays > worst.spanDays) {
      worst = { display: entry.display, count: entry.count, spanDays };
    }
  }
  if (!worst) return null;

  const months = Math.round(worst.spanDays / 30);
  const spanLabel = months >= 12 ? "over a year" : `${months} months`;
  return {
    id: "evergreen-promo-code",
    kind: "consider",
    title: `The code ${worst.display} never dies`,
    body: `${worst.display} has appeared in ${worst.count} of your campaigns spanning ${spanLabel}. A code that never expires stops being a campaign lever and becomes your de facto price: it spreads to coupon sites and browser extensions, so it gets applied at checkouts you never targeted. Rotate codes per campaign and let old ones lapse.`,
    learnHref: null,
    usesPeers: false
  };
}

/** How far back the burst detector looks, in timeline days. */
const BURST_WINDOW_DAYS = 180;
/** A silence must last at least this many days to count as a gap. */
const BURST_GAP_DAYS = 28;
/** Sends within this many days after the gap ends count as the burst. */
const BURST_FOLLOWUP_DAYS = 14;
const BURST_MIN_FOLLOWUP_SENDS = 3;
/** Below this many sends in the window, silences are just low volume. */
const BURST_MIN_WINDOW_SENDS = 12;

function burstyCadenceRule(own: BrandPageData): YourBrandInsight | null {
  // A brand that nominally sends less than weekly goes a month quiet as
  // a matter of course — silence is only an anomaly for regular senders.
  if (weeklySendRate(own) < 1) return null;

  const firstDay = own.totals.firstEmailAt?.slice(0, 10) ?? null;
  const days = own.cadence.dailyTimeline
    .slice(-BURST_WINDOW_DAYS)
    .filter((day) => firstDay === null || day.date >= firstDay);
  const counts = days.map((day) => day.count);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < BURST_MIN_WINDOW_SENDS) return null;

  const episodes: { gapDays: number; burstSends: number }[] = [];
  let zeroRun = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0) {
      zeroRun += 1;
      continue;
    }
    if (zeroRun >= BURST_GAP_DAYS) {
      const burstSends = counts
        .slice(i, i + BURST_FOLLOWUP_DAYS)
        .reduce((sum, count) => sum + count, 0);
      if (burstSends >= BURST_MIN_FOLLOWUP_SENDS) {
        episodes.push({ gapDays: zeroRun, burstSends });
      }
    }
    zeroRun = 0;
  }
  if (episodes.length === 0) return null;

  const worst = episodes.reduce((a, b) => (b.gapDays > a.gapDays ? b : a));
  const weeks = Math.round(worst.gapDays / 7);
  const repeatClause =
    episodes.length > 1 ? `, and that happened ${episodes.length} times` : "";
  return {
    id: "bursty-cadence",
    kind: "consider",
    title: "You go quiet, then blast",
    body: `In the last six months you went silent for ${weeks} weeks and then sent ${worst.burstSends} emails inside two weeks${repeatClause}. Mailbox providers read a burst after silence like a brand-new sender: engagement history has decayed, complaints spike, and the whole burst is likelier to land in spam. A steadier rhythm, even a slower one, protects the inbox placement you have already earned.`,
    learnHref: null,
    usesPeers: false
  };
}

const SUBJECT_TEMPLATE_MIN_SAMPLE = 20;
const SUBJECT_TEMPLATE_MIN_COUNT = 5;
const SUBJECT_TEMPLATE_MIN_SHARE = 0.2;

/**
 * Collapses a subject line to its reusable template: numbers become `#`
 * so "40% off everything" and "50% off everything" collide, emoji and
 * punctuation are stripped, whitespace is normalised. Two subjects with
 * the same key are the same line with the numbers swapped.
 */
function normalizeSubjectTemplate(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\d+([.,]\d+)?/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

function subjectRepetitionRule(own: BrandPageData): YourBrandInsight | null {
  const campaigns = own.seasonalSample.filter((email) =>
    isCampaignCategory(email.category)
  );
  if (campaigns.length < SUBJECT_TEMPLATE_MIN_SAMPLE) return null;

  const templates = new Map<string, { count: number; example: string }>();
  for (const email of campaigns) {
    const key = normalizeSubjectTemplate(email.subject ?? "");
    if (!key) continue;
    const entry = templates.get(key) ?? { count: 0, example: email.subject };
    entry.count += 1;
    templates.set(key, entry);
  }

  let top: { count: number; example: string } | null = null;
  for (const entry of templates.values()) {
    if (!top || entry.count > top.count) top = entry;
  }
  if (
    !top ||
    top.count < SUBJECT_TEMPLATE_MIN_COUNT ||
    top.count / campaigns.length < SUBJECT_TEMPLATE_MIN_SHARE
  ) {
    return null;
  }

  return {
    id: "subject-repetition",
    kind: "consider",
    title: "You keep sending the same subject line",
    body: `${top.count} of your last ${campaigns.length} campaigns went out under effectively the same subject line ("${top.example}"), sometimes with only the numbers swapped. The subject is the one thing subscribers see before deciding whether to open, and a line they have already scrolled past ${top.count} times reads as nothing new. Vary the angle, not just the digits.`,
    learnHref: null,
    usesPeers: false
  };
}

/* ------------------------------------------------------------------ */
/* Deliverability rules (raw header sample)                            */
/* ------------------------------------------------------------------ */

function unsubscribeHeadersRule(
  deliverability: DeliverabilitySignal[]
): YourBrandInsight | null {
  const measured = deliverability.filter((row) => row.listHeaders !== null);
  if (measured.length < MIN_HEADER_SAMPLE) return null;

  let compliant = 0;
  let missingEntirely = 0;
  for (const row of measured) {
    const verdict = classifyListHeaders(row.listHeaders);
    if (verdict.gmail_yahoo_one_click) compliant += 1;
    if (verdict.level === "missing") missingEntirely += 1;
  }
  if (compliant / measured.length >= 0.5) return null;

  const detail =
    missingEntirely > measured.length / 2
      ? "Your emails carry no List-Unsubscribe header at all, so Apple Mail hides its unsubscribe button and Gmail treats you as a riskier sender."
      : "Your emails have a List-Unsubscribe header but not the one-click POST variant (RFC 8058) that Gmail and Yahoo have required from bulk senders since 2024.";

  return {
    id: "unsubscribe-headers",
    kind: "fix",
    title: "One-click unsubscribe headers are missing",
    body: `${detail} It is a sending-platform setting, not a design change, and it directly affects whether you land in the inbox.`,
    learnHref: null,
    usesPeers: false
  };
}

function authFailuresRule(
  deliverability: DeliverabilitySignal[]
): YourBrandInsight | null {
  const measured = deliverability.filter((row) => row.authResults !== null);
  if (measured.length < MIN_HEADER_SAMPLE) return null;

  const failing: string[] = [];
  for (const mechanism of ["spf", "dkim", "dmarc"] as const) {
    const fails = measured.filter(
      (row) => row.authResults?.[mechanism] === "fail"
    ).length;
    if (fails >= measured.length / 2) failing.push(mechanism.toUpperCase());
  }
  if (failing.length === 0) return null;

  const list =
    failing.length === 1
      ? failing[0]
      : `${failing.slice(0, -1).join(", ")} and ${failing[failing.length - 1]}`;

  return {
    id: "auth-failures",
    kind: "fix",
    title: `${list} ${failing.length === 1 ? "is" : "are"} failing on your sends`,
    body: `Most of the recent emails we received from you fail ${list} authentication. Failed authentication is one of the strongest spam-folder signals there is, and it is usually a DNS record fix rather than an email change.`,
    learnHref: null,
    usesPeers: false
  };
}

/**
 * Alt-text coverage from one email's raw HTML. Regex-based, same posture
 * as the extraction pipeline: `<img>` tags are counted as content images
 * unless they are declared 1-2px (spacers, tracking pixels) or their
 * `src` matches the open-pixel registry. `withAlt` counts content images
 * whose `alt` is present and non-whitespace.
 */
export function altTextStatsFromHtml(html: string): AltTextSignal {
  let contentImages = 0;
  let withAlt = 0;
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const attr = (name: string): string | null => {
      const found = new RegExp(
        `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
        "i"
      ).exec(tag);
      if (!found) return null;
      return found[1] ?? found[2] ?? found[3] ?? "";
    };
    const dimension = (value: string | null): number | null => {
      if (value === null) return null;
      const parsed = /^\d+$/.exec(value.trim());
      return parsed ? Number(parsed[0]) : null;
    };
    const width = dimension(attr("width"));
    const height = dimension(attr("height"));
    if ((width ?? Infinity) <= 2 && (height ?? Infinity) <= 2) continue;
    const src = attr("src");
    if (src && detectOpenPixel([src])) continue;
    contentImages += 1;
    const alt = attr("alt");
    if (alt !== null && alt.trim().length > 0) withAlt += 1;
  }
  return { contentImages, withAlt };
}

/** Emails with at least this many content images count as measured. */
const MIN_ALT_IMAGES_PER_EMAIL = 3;
const MIN_ALT_EMAILS = 6;
const ALT_COVERAGE_THRESHOLD = 0.3;

function missingAltTextRule(
  altText: AltTextSignal[]
): YourBrandInsight | null {
  const measured = altText.filter(
    (row) => row.contentImages >= MIN_ALT_IMAGES_PER_EMAIL
  );
  if (measured.length < MIN_ALT_EMAILS) return null;

  const totalImages = measured.reduce((sum, row) => sum + row.contentImages, 0);
  const totalWithAlt = measured.reduce((sum, row) => sum + row.withAlt, 0);
  if (totalImages === 0) return null;
  const share = totalWithAlt / totalImages;
  if (share >= ALT_COVERAGE_THRESHOLD) return null;

  return {
    id: "missing-alt-text",
    kind: "fix",
    title: "Most of your images have no alt text",
    body: `${pct(1 - share)} of the images in your recent emails carry no alt text. With images blocked or still loading (Outlook blocks them by default, and many mobile connections are slow), those emails render as empty boxes, and screen-reader subscribers get nothing at all. Alt text on heroes, products and buttons is a template fix, not a redesign.`,
    learnHref: null,
    usesPeers: false
  };
}

/** Minimum captured history before "no welcome email" is a claim. */
const WELCOME_MIN_EMAILS = 20;
/** Capture must have started within this long of our signup. */
const WELCOME_MAX_CAPTURE_LAG_DAYS = 21;
/** And the subscription must be at least this old (vs the latest send). */
const WELCOME_MIN_TRACKED_DAYS = 30;

function noWelcomeFlowRule(
  own: BrandPageData,
  welcome: WelcomeSignal | null
): YourBrandInsight | null {
  if (!welcome || welcome.welcomeCount > 0) return null;
  if (own.totals.emailCount < WELCOME_MIN_EMAILS) return null;

  const subscribedMs = new Date(own.brand.subscribedSince).getTime();
  const firstMs = own.totals.firstEmailAt
    ? new Date(own.totals.firstEmailAt).getTime()
    : NaN;
  const lastMs = own.totals.lastEmailAt
    ? new Date(own.totals.lastEmailAt).getTime()
    : NaN;
  if (Number.isNaN(subscribedMs) || Number.isNaN(firstMs) || Number.isNaN(lastMs)) {
    return null;
  }
  // If our capture only began long after the signup, the welcome may
  // simply predate the first email we hold — stay silent rather than
  // accuse a brand of a gap in our own coverage.
  if (firstMs - subscribedMs > WELCOME_MAX_CAPTURE_LAG_DAYS * 86_400_000) {
    return null;
  }
  if (lastMs - subscribedMs < WELCOME_MIN_TRACKED_DAYS * 86_400_000) return null;

  const since = new Date(subscribedMs).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric"
  });
  return {
    id: "no-welcome-flow",
    kind: "fix",
    title: "You never sent us a welcome email",
    body: `We joined your list in ${since} and have captured ${own.totals.emailCount} emails since, but never a welcome. The welcome email is the highest-open send that exists, it lands at the one moment a subscriber has just asked to hear from you, and going straight to campaigns wastes it. Even a single automated welcome with your story and bestsellers outperforms any campaign in the calendar.`,
    learnHref: null,
    usesPeers: false
  };
}

/**
 * Open-tracking pixels vs the 2026 CNIL / Garante rulings. Fires
 * whenever the brand demonstrably uses dedicated open pixels — the
 * point is awareness ("if you have subscribers there, this now needs
 * consent"), so it doesn't try to guess where the brand's list lives.
 * Facts and dates mirror /learn/email-tracking-links.
 */
function trackingPixelConsentRule(own: BrandPageData): YourBrandInsight | null {
  const tracking = own.design.openTracking;
  if (tracking.measured < MIN_SAMPLE) return null;
  if (tracking.share < 0.3) return null;

  const via = tracking.provider ? ` via ${tracking.provider}` : "";
  return {
    id: "tracking-pixel-consent",
    kind: "consider",
    title: "Your open tracking now needs consent in France and Italy",
    body: `${pct(tracking.share)} of your recent emails load a dedicated open-tracking pixel${via}. France and Italy decided in 2026 to treat these pixels like cookies: measuring individual opens for marketing requires the recipient's explicit consent, collected at signup. France's rules apply from 14 July 2026 for existing lists (immediately for new signups) and Italy's from 28 October 2026. If you have subscribers in either country, check that your signup flow captures that consent, or turn off open tracking for those segments and key your automations on clicks instead.`,
    learnHref: "/learn/email-tracking-links",
    learnLabel: "Where the law stands, on the Learn page",
    usesPeers: false
  };
}

/* ------------------------------------------------------------------ */
/* Peer rules                                                          */
/* ------------------------------------------------------------------ */

function cadenceRule(
  own: BrandPageData,
  peers: BrandPageData[]
): YourBrandInsight | null {
  if (peers.length < MIN_PEERS) return null;
  const ownRate = weeklySendRate(own);
  const peerMedian = median(peers.map((peer) => weeklySendRate(peer)));
  if (peerMedian < 1) return null;

  const fmt = (rate: number) =>
    rate >= 10 ? String(Math.round(rate)) : (Math.round(rate * 10) / 10).toString();

  if (ownRate <= peerMedian * 0.5) {
    return {
      id: "cadence-low",
      kind: "consider",
      title: "You send far less than your competitors",
      body: `You average ${fmt(ownRate)} emails a week while the median across your comparison group is ${fmt(peerMedian)}. That is not automatically wrong, but it means competitors get several inbox impressions for every one of yours.`,
      learnHref: null,
      usesPeers: true
    };
  }

  if (ownRate >= peerMedian * 2 && ownRate >= 2) {
    // Name the actual multiple — the rule fires at 2x, but the ratio
    // keeps growing past the threshold and "double" would understate it.
    const ratio = ownRate / peerMedian;
    const multiple =
      ratio >= 4.5
        ? `${Math.round(ratio)} times`
        : ratio >= 3.5
          ? "four times"
          : ratio >= 2.5
            ? "three times"
            : "double";
    return {
      id: "cadence-high",
      kind: "consider",
      title: "You send far more than your competitors",
      body: `You average ${fmt(ownRate)} emails a week, roughly ${multiple} the median of ${fmt(peerMedian)} across your comparison group. High frequency can work, but it is worth checking your unsubscribe rate against it. List fatigue compounds quietly.`,
      learnHref: null,
      usesPeers: true
    };
  }

  return null;
}

type Slot = { dayIndex: number; daypartIndex: number };

/** Recent campaign sends bucketed into weekday and daypart slots. */
function slotCounts(brands: BrandPageData[]): {
  counts: number[][];
  total: number;
} {
  const counts = QUIET_ZONE_DAYPARTS.map(() =>
    new Array<number>(QUIET_ZONE_DAYS.length).fill(0)
  );
  let total = 0;

  // Same freshness convention as the compare dashboard's quiet zones:
  // only the ~90 days before the group's latest send count, anchored on
  // the payload (not wall clock) so the result is deterministic.
  let latest = Number.NEGATIVE_INFINITY;
  for (const brand of brands) {
    for (const email of brand.seasonalSample) {
      if (!isCampaignCategory(email.category)) continue;
      const ts = new Date(email.receivedAt).getTime();
      if (!Number.isNaN(ts) && ts > latest) latest = ts;
    }
  }
  const cutoff =
    latest === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : latest - 90 * 86_400_000;

  for (const brand of brands) {
    for (const email of brand.seasonalSample) {
      if (!isCampaignCategory(email.category)) continue;
      const ts = new Date(email.receivedAt).getTime();
      if (Number.isNaN(ts) || ts < cutoff) continue;
      let parts;
      try {
        parts = getZonedParts(email.receivedAt);
      } catch {
        continue;
      }
      const dayIndex = (parts.weekday + 6) % 7;
      const daypartIndex = QUIET_ZONE_DAYPARTS.findIndex(
        (daypart) => parts.hour >= daypart.fromHour && parts.hour < daypart.toHour
      );
      if (daypartIndex === -1) continue;
      counts[daypartIndex][dayIndex] += 1;
      total += 1;
    }
  }

  return { counts, total };
}

function slotLabel(slot: Slot): string {
  return `${QUIET_ZONE_DAYS[slot.dayIndex]} ${QUIET_ZONE_DAYPARTS[
    slot.daypartIndex
  ].label.toLowerCase()}`;
}

function sendTimeCollisionRule(
  own: BrandPageData,
  peers: BrandPageData[]
): YourBrandInsight | null {
  if (peers.length < MIN_PEERS) return null;

  const ownSlots = slotCounts([own]);
  const peerSlots = slotCounts(peers);
  if (peerSlots.total < MIN_PEER_SENDS) return null;

  // The user's dominant send window: their busiest slot, provided it
  // carries a meaningful share of their recent sends.
  let ownTop: Slot | null = null;
  let ownTopCount = 0;
  QUIET_ZONE_DAYPARTS.forEach((_, daypartIndex) => {
    QUIET_ZONE_DAYS.forEach((_, dayIndex) => {
      const count = ownSlots.counts[daypartIndex][dayIndex];
      if (count > ownTopCount) {
        ownTopCount = count;
        ownTop = { dayIndex, daypartIndex };
      }
    });
  });
  if (!ownTop || ownTopCount < 5 || ownTopCount / Math.max(1, ownSlots.total) < 0.25) {
    return null;
  }
  const top: Slot = ownTop;

  // Only interesting when their window is also the group's most (or near
  // most) contested one.
  const peerCountInOwnSlot = peerSlots.counts[top.daypartIndex][top.dayIndex];
  const peerMax = Math.max(...peerSlots.counts.flat());
  if (peerMax === 0 || peerCountInOwnSlot < peerMax * 0.8) return null;

  // The recommendation: the quietest slot, weekdays and earlier dayparts
  // preferred (same tie-break the compare dashboard uses).
  const slotScore = (slot: Slot) =>
    (slot.dayIndex < 5 ? 2 : 0) + (slot.daypartIndex < 2 ? 1 : 0);
  let quietest: Slot = { dayIndex: 0, daypartIndex: 0 };
  let quietestCount = Number.POSITIVE_INFINITY;
  QUIET_ZONE_DAYPARTS.forEach((_, daypartIndex) => {
    QUIET_ZONE_DAYS.forEach((_, dayIndex) => {
      const slot = { dayIndex, daypartIndex };
      const count = peerSlots.counts[daypartIndex][dayIndex];
      if (
        count < quietestCount ||
        (count === quietestCount && slotScore(slot) > slotScore(quietest))
      ) {
        quietestCount = count;
        quietest = slot;
      }
    });
  });

  // If even the quietest slot carries real traffic, "send there instead"
  // would be dishonest — an all-slots-covered group is the compare
  // dashboard's story, not an action item.
  if (quietestCount > Math.max(1, Math.round(peerSlots.total * 0.03))) {
    return null;
  }

  return {
    id: "send-time-collision",
    kind: "consider",
    title: "You send when your competitors send",
    body: `Your emails usually land ${slotLabel(top)}, which is also the most contested window in your comparison group (${peerCountInOwnSlot} of their ${peerSlots.total} recent campaign sends). ${slotLabel(quietest).replace(/^./, (c) => c.toUpperCase())} is close to empty. A send there competes with almost nobody.`,
    learnHref: null,
    usesPeers: true
  };
}

function urgencyOveruseRule(
  own: BrandPageData,
  peers: BrandPageData[]
): YourBrandInsight | null {
  if (peers.length < MIN_PEERS) return null;
  if (own.seasonalSample.length < 15) return null;

  const ownShare = urgencyShare(own);
  if (ownShare < 0.3) return null;
  const peerAvg =
    peers.reduce((sum, peer) => sum + urgencyShare(peer), 0) / peers.length;
  if (ownShare < peerAvg * 2) return null;

  return {
    id: "urgency-overuse",
    kind: "consider",
    title: "You lean on urgency more than anyone around you",
    body: `${pct(ownShare)} of your recent subject lines use scarcity language ("last chance", "ends tonight"), against ${pct(peerAvg)} on average across your comparison group. Urgency works until subscribers notice everything is urgent, and then none of it is.`,
    learnHref: null,
    usesPeers: true
  };
}

/** Sampled emails required before discount shares are comparable. */
const DISCOUNT_PEER_MIN_SAMPLE = 20;
/** Own share must be at least this before the rule can fire at all. */
const DISCOUNT_PEER_MIN_OWN_SHARE = 0.3;
/** Below this, the peer group "almost never" discounts. */
const DISCOUNT_PEER_NEGLIGIBLE = 0.02;

function discountFrequencyPeersRule(
  own: BrandPageData,
  peers: BrandPageData[]
): YourBrandInsight | null {
  if (peers.length < MIN_PEERS) return null;
  if (own.totals.sampleSize < DISCOUNT_PEER_MIN_SAMPLE) return null;

  const ownShare = own.promo.discountShare;
  if (ownShare < DISCOUNT_PEER_MIN_OWN_SHARE) return null;
  const peerMedian = median(peers.map((peer) => peer.promo.discountShare));
  if (ownShare < peerMedian * 2) return null;

  let depthNote = "";
  const ownDepth = own.promo.avgDiscount;
  const peerDepths = peers
    .map((peer) => peer.promo.avgDiscount)
    .filter((depth): depth is number => depth !== null);
  if (ownDepth !== null && peerDepths.length >= MIN_PEERS) {
    const peerDepthMedian = median(peerDepths);
    if (ownDepth >= peerDepthMedian + 10) {
      depthNote = ` Your discounts are also deeper, averaging ${Math.round(
        ownDepth
      )}% against their ${Math.round(peerDepthMedian)}%.`;
    }
  }

  const peerClause =
    peerMedian < DISCOUNT_PEER_NEGLIGIBLE
      ? "while your competitors almost never do"
      : `while the median across your comparison group is ${pct(peerMedian)}`;
  return {
    id: "discount-frequency-peers",
    kind: "consider",
    title: "You discount more than anyone around you",
    body: `${pct(ownShare)} of your recent emails carry a stated discount, ${peerClause}.${depthNote} When the discount is the default message, it stops reading as an event and starts reading as your price level, and subscribers learn there is no reason to ever buy at full price.`,
    learnHref: null,
    usesPeers: true
  };
}

/** Matched emails a brand needs before its run-up timing is trusted. */
const SEASONAL_MIN_MATCHES = 3;
/** How much later than the peer median counts as a real late start. */
const SEASONAL_LATE_BY_DAYS = 14;

function seasonalLateStartRule(
  own: BrandPageData,
  peers: BrandPageData[]
): YourBrandInsight | null {
  if (peers.length < MIN_PEERS) return null;

  const toInputs = (brand: BrandPageData): SeasonalEmailInput[] =>
    brand.seasonalSample.map((email) => ({
      subject: email.subject,
      preheader: email.preheader,
      receivedAt: email.receivedAt
    }));
  const ownEmails = toInputs(own);

  // Pick the one event with the most matched emails across the group —
  // one card about Black Friday beats four half-relevant seasonal cards.
  let best: {
    label: string;
    ownLead: number;
    peerLeads: number[];
    weight: number;
  } | null = null;
  for (const event of SEASONAL_EVENTS) {
    const ownRunup = analyzeSeasonalRunup(ownEmails, event);
    if (
      ownRunup.matchedCount < SEASONAL_MIN_MATCHES ||
      ownRunup.typicalLeadDays === null
    ) {
      continue;
    }
    const peerLeads: number[] = [];
    let weight = ownRunup.matchedCount;
    for (const peer of peers) {
      const runup = analyzeSeasonalRunup(toInputs(peer), event);
      if (
        runup.matchedCount >= SEASONAL_MIN_MATCHES &&
        runup.typicalLeadDays !== null
      ) {
        peerLeads.push(runup.typicalLeadDays);
        weight += runup.matchedCount;
      }
    }
    if (peerLeads.length < MIN_PEERS) continue;
    if (!best || weight > best.weight) {
      best = {
        label: event.label,
        ownLead: ownRunup.typicalLeadDays,
        peerLeads,
        weight
      };
    }
  }
  if (!best) return null;

  const peerMedianLead = Math.round(median(best.peerLeads));
  const ownLead = Math.round(best.ownLead);
  if (peerMedianLead - ownLead < SEASONAL_LATE_BY_DAYS) return null;

  const extraWeeks = Math.round((peerMedianLead - ownLead) / 7);
  return {
    id: "seasonal-late-start",
    kind: "consider",
    title: `You start ${best.label} later than your competitors`,
    body: `Your first ${best.label} email typically lands ${ownLead} days ahead of the day itself, while the median brand in your comparison group starts ${peerMedianLead} days out. That is roughly ${extraWeeks} ${extraWeeks === 1 ? "week" : "weeks"} your competitors spend building wishlists before you show up. Starting earlier with light touches, teasers and gift guides, claims that attention without spending your offer.`,
    learnHref: null,
    usesPeers: true
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function buildYourBrandInsights(input: {
  own: BrandPageData;
  peers: BrandPageData[];
  deliverability: DeliverabilitySignal[];
  /** Alt-text sample; empty (the default) keeps the rule silent. */
  altText?: AltTextSignal[];
  /** All-time welcome evidence; null (the default) keeps the rule silent. */
  welcome?: WelcomeSignal | null;
}): YourBrandInsight[] {
  const { own, peers, deliverability, altText = [], welcome = null } = input;

  const insights: (YourBrandInsight | null)[] = [
    // Fixes first: deliverability and rendering problems outrank
    // strategic considerations in the rendered list.
    authFailuresRule(deliverability),
    unsubscribeHeadersRule(deliverability),
    noWelcomeFlowRule(own, welcome),
    trackingPixelConsentRule(own),
    ...previewTextRules(own),
    heavyEmailsRule(own),
    missingAltTextRule(altText),
    sendTimeCollisionRule(own, peers),
    cadenceRule(own, peers),
    burstyCadenceRule(own),
    deadlineExtensionsRule(own),
    discountCreepRule(own),
    discountFrequencyPeersRule(own, peers),
    saleHeavyRule(own),
    evergreenPromoCodeRule(own),
    urgencyOveruseRule(own, peers),
    subjectRepetitionRule(own),
    longSubjectsRule(own),
    seasonalLateStartRule(own, peers),
    darkModeRule(own, peers)
  ];

  return insights.filter((insight): insight is YourBrandInsight =>
    Boolean(insight)
  );
}
