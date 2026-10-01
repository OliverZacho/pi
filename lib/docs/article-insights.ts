/**
 * Turns a raw archive dataset (`lib/docs/insights.ts`) into the two things an
 * article needs at render time:
 *   - `tokens`  — formatted strings keyed by the `{{token}}` names used in body
 *                 copy. Only present when the data loaded; a missing token makes
 *                 the page drop that paragraph (no raw `{{…}}`, no fabricated
 *                 numbers).
 *   - `figures` — prepared `FigureData` keyed by the `dataKey` a section's
 *                 `figure` references, rendered by `components/docs/InsightFigure`.
 *
 * If the dataset is briefly unavailable both come back empty and the article
 * falls back to its static prose + CTA.
 */
import type { DocInsightKey } from "./content";
import {
  formatHourOfDay,
  getActiveTimeZone
} from "@/lib/datetime";
import {
  getCadenceInsights,
  getContentMixInsights,
  getDiscountInsights,
  getEspInsights,
  getSendTimeInsights,
  type ExampleBrand
} from "./insights";

export type FigureData =
  | { kind: "statStrip"; items: { value: string; label: string }[] }
  /** A single 100%-wide bar split into proportional, ranked segments. */
  | { kind: "shareBar"; caption?: string; segments: { label: string; share: number }[] }
  /** 24-cell hour-of-day heatmap; `peakIndex` is outlined. */
  | { kind: "heatStrip"; caption?: string; cells: number[]; peakIndex: number }
  /** Ranked bars with an optional average reference line. */
  | {
      kind: "rangeBars";
      caption?: string;
      items: { label: string; value: number; display: string }[];
      reference?: { label: string; value: number };
    }
  /** Two metrics per row (e.g. frequency vs depth) as paired bars. */
  | {
      kind: "pairedBars";
      caption?: string;
      aLabel: string;
      bLabel: string;
      items: {
        label: string;
        a: { value: number; display: string };
        b: { value: number; display: string };
      }[];
    };

/**
 * The real brands behind an article's numbers, each linked to its brand page
 * with that brand's own figure. Absent when no brand clears the example floor.
 */
export type ArticleExamples = {
  heading: string;
  intro: string;
  brands: { slug: string; name: string; stat: string }[];
};

export type ArticleInsights = {
  tokens: Record<string, string>;
  figures: Record<string, FigureData>;
  examples?: ArticleExamples;
};

const EMPTY: ArticleInsights = { tokens: {}, figures: {} };

/** One decimal place, dropping a trailing ".0". */
const one = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
};

/** "a", "a and b", "a, b and c". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Builds the examples block, or nothing when there are too few brands to make
 * a list worth reading (or the cached insight predates the field).
 */
function examplesBlock(
  heading: string,
  intro: string,
  brands: ExampleBrand[] | undefined,
  stat: (b: ExampleBrand) => string
): ArticleExamples | undefined {
  if (!brands || brands.length < 3) return undefined;
  return {
    heading,
    intro,
    brands: brands.map((b) => ({ slug: b.slug, name: b.name, stat: stat(b) }))
  };
}

/** Assigns only defined, non-empty values so missing tokens drop their paragraph. */
function put(tokens: Record<string, string>, key: string, value: string | undefined) {
  if (value) tokens[key] = value;
}

export async function loadArticleInsights(
  key: DocInsightKey
): Promise<ArticleInsights> {
  switch (key) {
    case "esp":
      return buildEsp();
    case "sendTime":
      return buildSendTime();
    case "cadence":
      return buildCadence();
    case "discount":
      return buildDiscount();
    case "contentMix":
      return buildContentMix();
    default:
      return EMPTY;
  }
}

async function buildEsp(): Promise<ArticleInsights> {
  const d = await getEspInsights();
  if (!d) return EMPTY;

  const topThree = d.ranking.slice(0, 3).reduce((s, r) => s + r.share, 0);

  const tokens: Record<string, string> = {};
  put(tokens, "brandCount", d.brandCount.toString());
  put(tokens, "espBrandCount", d.espBrandCount.toString());
  put(tokens, "topEsp", d.top.label);
  put(tokens, "topEspShare", `${d.top.share}%`);
  put(tokens, "secondEsp", d.second?.label);
  put(tokens, "secondEspShare", d.second ? `${d.second.share}%` : undefined);
  put(tokens, "topThreeShare", topThree > 0 ? `${topThree}%` : undefined);
  put(
    tokens,
    "espByIndustry",
    d.byIndustry.length
      ? joinList(
          d.byIndustry
            .slice(0, 3)
            .map((i) => `${i.industry} on ${i.topEsp} (${i.share}%)`)
        ) + "."
      : undefined
  );

  // Hero: the whole field as one proportional bar, plus an "Other" remainder.
  const sum = d.ranking.reduce((s, r) => s + r.share, 0);
  const segments = d.ranking.map((r) => ({ label: r.label, share: r.share }));
  if (sum < 100) segments.push({ label: "Other platforms", share: 100 - sum });

  const figures: Record<string, FigureData> = {
    espShare: {
      kind: "shareBar",
      caption: `Share of ${d.espBrandCount} tracked brands, by primary sending platform`,
      segments
    }
  };
  if (d.byIndustry.length) {
    figures.espIndustries = {
      kind: "rangeBars",
      caption: "How decisively each industry has consolidated on one platform",
      items: d.byIndustry.map((i) => ({
        label: `${i.industry} · ${i.topEsp}`,
        value: i.share,
        display: `${i.share}%`
      }))
    };
  }

  const leaders = [...new Set((d.examples ?? []).map((b) => b.label))].filter(
    (l): l is string => Boolean(l)
  );
  const examples = examplesBlock(
    leaders.length === 2
      ? `Brands sending on ${leaders[0]} and ${leaders[1]}`
      : "Brands by sending platform",
    "The busiest tracked brands on the two most used platforms. Open any of them to see its full sending pattern.",
    d.examples,
    (b) => b.label ?? ""
  );

  return { tokens, figures, examples };
}

async function buildSendTime(): Promise<ArticleInsights> {
  const d = await getSendTimeInsights();
  if (!d) return EMPTY;

  const zone = getActiveTimeZone();
  // Quietest daytime hour (6am–9pm) — the gap the "find the gap" section uses.
  let quietHour = 6;
  for (let h = 6; h <= 21; h++) if (d.hourly[h] < d.hourly[quietHour]) quietHour = h;

  const tokens: Record<string, string> = {};
  put(tokens, "peakHourLabel", d.peak.label);
  put(tokens, "peakShare", `${d.peak.share}%`);
  put(tokens, "morningShare", `${d.morningShare}%`);
  put(tokens, "afternoonShare", `${d.afternoonShare}%`);
  put(tokens, "eveningShare", `${d.eveningShare}%`);
  put(
    tokens,
    "quietHourLabel",
    formatHourOfDay(quietHour, { case: "lower", withZone: true, zone })
  );
  put(
    tokens,
    "sendTimeByIndustry",
    d.byIndustry.length
      ? joinList(d.byIndustry.slice(0, 3).map((i) => `${i.industry} near ${i.peakLabel}`)) + "."
      : undefined
  );

  const figures: Record<string, FigureData> = {
    sendHeat: {
      kind: "heatStrip",
      caption: "Send volume by hour of day — darker is busier",
      cells: d.hourly,
      peakIndex: d.peakHour
    },
    sendTimeStats: {
      kind: "statStrip",
      items: [
        { value: d.peak.label, label: "Peak send hour" },
        { value: `${d.morningShare}%`, label: "Land in the morning" },
        { value: `${d.eveningShare}%`, label: "Land in the evening" }
      ]
    }
  };

  const examples = examplesBlock(
    `Brands that send at ${d.peak.label}`,
    "Brands whose own busiest hour is the archive's peak, ranked by how much of their email lands in it.",
    d.examples,
    (b) => `${b.value}% of sends`
  );

  return { tokens, figures, examples };
}

async function buildCadence(): Promise<ArticleInsights> {
  const d = await getCadenceInsights();
  if (!d) return EMPTY;

  const tokens: Record<string, string> = {};
  put(tokens, "brandCount", d.brandCount.toString());
  put(tokens, "avgPerWeek", one(d.avgPerWeek));
  put(tokens, "busiestIndustry", d.busiest?.industry);
  put(tokens, "busiestPerWeek", d.busiest ? one(d.busiest.perWeek) : undefined);
  put(tokens, "calmestIndustry", d.calmest?.industry);
  put(tokens, "calmestPerWeek", d.calmest ? one(d.calmest.perWeek) : undefined);

  const statItems: { value: string; label: string }[] = [
    { value: `${one(d.avgPerWeek)}`, label: "Emails / week, typical brand" }
  ];
  if (d.busiest)
    statItems.push({ value: `${one(d.busiest.perWeek)}`, label: `${d.busiest.industry} (busiest)` });
  if (d.calmest)
    statItems.push({ value: `${one(d.calmest.perWeek)}`, label: `${d.calmest.industry} (calmest)` });

  const figures: Record<string, FigureData> = {
    cadenceStats: { kind: "statStrip", items: statItems },
    cadenceIndustries: {
      kind: "rangeBars",
      caption: "Average emails per week by industry — line marks the all-brand average",
      reference: { label: "Average", value: d.avgPerWeek },
      items: d.byIndustry.map((i) => ({
        label: i.industry,
        value: i.perWeek,
        display: `${one(i.perWeek)}/wk`
      }))
    }
  };

  const examples = examplesBlock(
    "The busiest senders in the archive",
    "Brands with at least a month of tracked history, ranked by how many emails they send a week.",
    d.examples,
    (b) => `${one(b.value)} a week`
  );

  return { tokens, figures, examples };
}

async function buildDiscount(): Promise<ArticleInsights> {
  const d = await getDiscountInsights();
  if (!d) return EMPTY;

  const tokens: Record<string, string> = {};
  put(tokens, "discountShare", `${d.discountShare}%`);
  put(tokens, "avgDepth", `${d.avgDepth}%`);
  put(tokens, "maxDepth", `${d.maxDepth}%`);
  put(
    tokens,
    "discountByIndustry",
    d.byIndustry.length
      ? joinList(
          d.byIndustry
            .slice(0, 3)
            .map((i) => `${i.industry} discounts ${i.share}% of its sends at ${i.avgDepth}% off`)
        ) + "."
      : undefined
  );

  const figures: Record<string, FigureData> = {
    discountStats: {
      kind: "statStrip",
      items: [
        { value: `${d.discountShare}%`, label: "Of a brand's sends carry an offer" },
        { value: `${d.avgDepth}%`, label: "Average discount depth" },
        { value: `${d.maxDepth}%`, label: "Deepest cut on record" }
      ]
    },
    discountIndustries: {
      kind: "pairedBars",
      caption: "How often each industry discounts versus how deep it cuts",
      aLabel: "Share of sends discounted",
      bLabel: "Average depth",
      items: d.byIndustry.map((i) => ({
        label: i.industry,
        a: { value: i.share, display: `${i.share}%` },
        b: { value: i.avgDepth, display: `${i.avgDepth}%` }
      }))
    }
  };

  const examples = examplesBlock(
    "The brands that discount most often",
    "Tracked brands ranked by the share of their emails that name a discount.",
    d.examples,
    (b) => `${b.value}% of sends`
  );

  return { tokens, figures, examples };
}

async function buildContentMix(): Promise<ArticleInsights> {
  const d = await getContentMixInsights();
  if (!d) return EMPTY;

  const tokens: Record<string, string> = {};
  put(tokens, "topType", d.top.label);
  put(tokens, "topTypeShare", `${d.top.share}%`);
  put(tokens, "secondType", d.second?.label);
  put(tokens, "secondTypeShare", d.second ? `${d.second.share}%` : undefined);
  put(tokens, "saleShare", `${d.saleShare}%`);
  put(
    tokens,
    "contentByIndustry",
    d.byIndustry.length
      ? joinList(
          d.byIndustry.slice(0, 3).map((i) => `${i.industry} leans to ${i.topType} (${i.share}%)`)
        ) + "."
      : undefined
  );

  // Hero: the campaign inbox as one proportional bar, with an "Other" remainder.
  const sum = d.ranking.reduce((s, r) => s + r.share, 0);
  const segments = d.ranking.map((r) => ({ label: r.label, share: r.share }));
  if (sum < 100) segments.push({ label: "Other types", share: 100 - sum });

  const figures: Record<string, FigureData> = {
    contentMix: {
      kind: "shareBar",
      caption: "Share of broadcast campaigns by type (excludes welcome)",
      segments
    }
  };

  const examples = examplesBlock(
    "What the busiest brands lead with",
    "The highest volume brands in the archive and the campaign type that makes up most of their inbox.",
    d.examples,
    (b) => `${b.value}% ${(b.label ?? "").toLowerCase()}`
  );

  return { tokens, figures, examples };
}
