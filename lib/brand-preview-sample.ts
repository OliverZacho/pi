import type { BrandPageData } from "@/lib/brand-db";

/**
 * A single, hand-made fake dataset used to render the *real* brand-dashboard
 * charts behind the paywall for logged-out / unpaid visitors.
 *
 * It is deliberately the same numbers for every brand: it's a teaser, not the
 * brand's actual data (which we never ship to an unpaid client — see
 * `app/brands/[id]/page.tsx`). Rendering the genuine chart components with this
 * sample, then blurring the result, makes the locked page look exactly like the
 * paid dashboard rather than an obvious placeholder.
 *
 * Everything is derived from fixed constants (no `Date.now()` / `Math.random()`)
 * so server and client render identically and there are no hydration mismatches.
 */

/** Slices of {@link BrandPageData} consumed by the charts we render locked. */
export type BrandPreviewSample = Pick<
  BrandPageData,
  | "totals"
  | "cadence"
  | "promo"
  | "emojis"
  | "categories"
  | "esp"
  | "design"
  | "subjects"
  | "ctas"
>;

const MS_PER_DAY = 86_400_000;

/** Monday anchoring the 26-week cadence sparkline (fixed, in the past). */
const CADENCE_ANCHOR = new Date("2025-01-06T00:00:00Z");

const WEEKLY_COUNTS = [
  2, 3, 1, 4, 2, 5, 3, 2, 4, 3, 1, 4, 5, 3, 2, 4, 3, 5, 2, 4, 3, 2, 5, 4, 3, 6
];

const weekly = WEEKLY_COUNTS.map((count, i) => ({
  weekStart: new Date(CADENCE_ANCHOR.getTime() + i * 7 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10),
  count
}));

const lastWeekStart = weekly[weekly.length - 1].weekStart;
const firstWeekStart = weekly[0].weekStart;

export const BRAND_PREVIEW_SAMPLE: BrandPreviewSample = {
  totals: {
    emailCount: 482,
    sampleSize: 482,
    firstEmailAt: `${firstWeekStart}T09:12:00Z`,
    lastEmailAt: `${lastWeekStart}T08:03:00Z`
  },
  cadence: {
    avgDaysBetween: 3.4,
    weekly,
    typicalDay: { index: 2, label: "Tuesday", share: 0.34 },
    typicalHour: { hour: 10, label: "10:00", share: 0.28 },
    // Two believable peaks: a strong ~10am and a softer ~7pm.
    hourly: [
      1, 0, 0, 0, 0, 1, 3, 8, 18, 34, 42, 30, 22, 16, 14, 12, 16, 22, 28, 24,
      14, 8, 4, 2
    ],
    dailyTimeline: []
  },
  promo: {
    discountEmails: 156,
    discountShare: 0.32,
    avgDiscount: 22,
    maxDiscount: 50,
    maxDiscountAt: `${lastWeekStart}T08:03:00Z`
  },
  emojis: {
    emailsWithEmoji: 212,
    share: 0.44,
    totalEmojis: 384,
    avgPerEmojiEmail: 1.8,
    top: [
      { emoji: "🔥", count: 42 },
      { emoji: "✨", count: 31 },
      { emoji: "🎉", count: 24 },
      { emoji: "💛", count: 18 },
      { emoji: "⏰", count: 15 }
    ]
  },
  categories: [
    { id: "sale", label: "Sale", count: 188 },
    { id: "product_launch", label: "Product launch", count: 96 },
    { id: "content", label: "Newsletter", count: 74 },
    { id: "welcome", label: "Welcome", count: 42 },
    { id: "event", label: "Event", count: 28 },
    { id: "loyalty", label: "Loyalty", count: 18 }
  ],
  esp: {
    primary: { id: "klaviyo", label: "Klaviyo", share: 0.86 },
    distribution: []
  },
  design: {
    palette: [
      { hex: "#0f172a", count: 80 },
      { hex: "#e11d48", count: 64 },
      { hex: "#f59e0b", count: 52 },
      { hex: "#10b981", count: 40 },
      { hex: "#6366f1", count: 33 },
      { hex: "#ec4899", count: 26 },
      { hex: "#14b8a6", count: 20 },
      { hex: "#f97316", count: 14 }
    ],
    fonts: [
      { family: "Helvetica Neue", count: 220 },
      { family: "Georgia", count: 96 }
    ],
    gifShare: 0.38,
    darkModeShare: 0.21
  },
  subjects: {
    avgLength: 41,
    samples: [
      "Your weekend edit is here ✨",
      "Last chance — 30% off ends tonight",
      "New in: the autumn collection",
      "We saved your cart for you 🛒",
      "Members get early access"
    ]
  },
  ctas: [
    { text: "Shop now", count: 142 },
    { text: "Discover", count: 88 },
    { text: "Shop the sale", count: 64 },
    { text: "Read more", count: 52 },
    { text: "Get 20% off", count: 40 },
    { text: "Explore", count: 33 },
    { text: "Find your size", count: 21 }
  ]
};

/**
 * Sparse per-day activity for the GitHub-style calendar. Sends land mostly on
 * weekdays across a fixed trailing year, but the exact days and categories are
 * driven by a hash of the day index so the grid looks organically random rather
 * than a repeating block. Deterministic (same output every render) so there's
 * no hydration mismatch, but it reads like real, irregular send behaviour.
 */
const CAL_START = new Date("2025-01-01T00:00:00Z");
const CAL_DAYS = 364;

/** Weighted category mix — `sale` dominates, the long tail thins out. */
const CAL_CATEGORIES: { id: string; label: string; weight: number }[] = [
  { id: "sale", label: "Sale", weight: 0.32 },
  { id: "product_launch", label: "Product launch", weight: 0.18 },
  { id: "content", label: "Newsletter", weight: 0.16 },
  { id: "welcome", label: "Welcome", weight: 0.1 },
  { id: "event", label: "Event", weight: 0.1 },
  { id: "loyalty", label: "Loyalty", weight: 0.08 },
  { id: "seasonal", label: "Seasonal", weight: 0.06 }
];

/** Deterministic hash → float in [0, 1). Looks random, never uses Math.random. */
function hashUnit(n: number): number {
  let t = (n + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pickCategory(r: number): { id: string; label: string } {
  let acc = 0;
  for (const c of CAL_CATEGORIES) {
    acc += c.weight;
    if (r <= acc) return { id: c.id, label: c.label };
  }
  const last = CAL_CATEGORIES[CAL_CATEGORIES.length - 1];
  return { id: last.id, label: last.label };
}

function buildCalendar(): BrandPageData["calendar"] {
  const days: BrandPageData["calendar"]["days"] = [];
  for (let i = 0; i < CAL_DAYS; i++) {
    const d = new Date(CAL_START.getTime() + i * MS_PER_DAY);
    const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
    const isWeekday = dow !== 0 && dow !== 6;
    // Irregular send rate: ~55% of weekdays, ~12% of weekend days.
    const pSend = isWeekday ? 0.55 : 0.12;
    if (hashUnit(i * 3 + 1) >= pSend) continue;

    const iso = d.toISOString().slice(0, 10);
    const first = pickCategory(hashUnit(i * 3 + 2));
    const emails = [
      {
        id: `preview-${i}-a`,
        subject: "Campaign",
        category: first.id,
        categoryLabel: first.label,
        receivedAt: d.toISOString()
      }
    ];
    // Occasionally a second send the same day → a split-colour cell.
    if (hashUnit(i * 3 + 3) < 0.22) {
      const second = pickCategory(hashUnit(i * 7 + 5));
      emails.push({
        id: `preview-${i}-b`,
        subject: "Campaign",
        category: second.id,
        categoryLabel: second.label,
        receivedAt: new Date(d.getTime() + 6 * 3600_000).toISOString()
      });
    }
    days.push({ date: iso, emails });
  }
  return {
    start: CAL_START.toISOString().slice(0, 10),
    end: new Date(CAL_START.getTime() + (CAL_DAYS - 1) * MS_PER_DAY)
      .toISOString()
      .slice(0, 10),
    days
  };
}

export const BRAND_PREVIEW_CALENDAR = buildCalendar();
