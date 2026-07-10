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
  "urgency-overuse"
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
    return [
      {
        id: "preview-text-padding",
        kind: "fix",
        title: "Your preview text runs into body text",
        body: `Only ${padding.padded} of your last ${padding.measured} emails pad the preview text with invisible characters. Without the padding, inboxes append your body copy (or an unsubscribe line) right after the preview you wrote.`,
        learnHref: "/learn/preheader-padding-trick",
        usesPeers: false
      }
    ];
  }

  return [];
}

function heavyEmailsRule(own: BrandPageData): YourBrandInsight | null {
  const images = own.design.images;
  if (images.emailsMeasured < MIN_SAMPLE) return null;
  if (images.avgBytesPerEmail === null || images.avgBytesPerEmail < 2.5 * MB) {
    return null;
  }

  const gifNote =
    own.design.gifShare >= 0.3
      ? " GIFs are the usual culprit, a short looping video frame stack weighs many times a static image."
      : "";

  return {
    id: "heavy-emails",
    kind: "fix",
    title: "Your emails are heavy",
    body: `Your recent emails average ${fmtMb(images.avgBytesPerEmail)} MB of images. On mobile connections that means visible loading, and some clients stop fetching altogether. Converting hero images to WebP or AVIF usually cuts the weight by more than half.${gifNote}`,
    learnHref: null,
    usesPeers: false
  };
}

function darkModeRule(own: BrandPageData): YourBrandInsight | null {
  if (own.totals.sampleSize < MIN_SAMPLE) return null;
  if (own.design.darkModeShare > 0) return null;

  return {
    id: "no-dark-mode",
    kind: "consider",
    title: "No dark mode handling detected",
    body: `None of your recent emails declare dark-mode styles. Roughly a third of inbox time happens in dark mode, where unstyled emails get their colors force-inverted, which is where broken logos and unreadable buttons come from.`,
    learnHref: null,
    usesPeers: false
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
    title: "Almost everything you send is a sale",
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
    body: `You extended ${offersExtended} of your last ${offersWithDeadline} offers past their stated end date. Extensions convert in the short term, but subscribers who have seen a deadline move stop treating your deadlines as real, and the urgency stops working.`,
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
    return {
      id: "cadence-high",
      kind: "consider",
      title: "You send far more than your competitors",
      body: `You average ${fmt(ownRate)} emails a week, roughly double the ${fmt(peerMedian)} median across your comparison group. High frequency can work, but it is worth checking your unsubscribe rate against it, list fatigue compounds quietly.`,
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

  return {
    id: "send-time-collision",
    kind: "consider",
    title: "You send when your competitors send",
    body: `Your emails usually land ${slotLabel(top)}, which is also the most contested window in your comparison group (${peerCountInOwnSlot} of their ${peerSlots.total} recent campaign sends). ${slotLabel(quietest).replace(/^./, (c) => c.toUpperCase())} is close to empty, a send there competes with almost nobody.`,
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
    body: `${pct(ownShare)} of your recent subject lines use scarcity language ("last chance", "ends tonight"), against ${pct(peerAvg)} on average across your comparison group. Urgency works until subscribers notice everything is urgent, then none of it is.`,
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
}): YourBrandInsight[] {
  const { own, peers, deliverability } = input;

  const insights: (YourBrandInsight | null)[] = [
    // Fixes first: deliverability and rendering problems outrank
    // strategic considerations in the rendered list.
    authFailuresRule(deliverability),
    unsubscribeHeadersRule(deliverability),
    ...previewTextRules(own),
    heavyEmailsRule(own),
    sendTimeCollisionRule(own, peers),
    cadenceRule(own, peers),
    deadlineExtensionsRule(own),
    discountCreepRule(own),
    saleHeavyRule(own),
    urgencyOveruseRule(own, peers),
    longSubjectsRule(own),
    darkModeRule(own)
  ];

  return insights.filter((insight): insight is YourBrandInsight =>
    Boolean(insight)
  );
}
