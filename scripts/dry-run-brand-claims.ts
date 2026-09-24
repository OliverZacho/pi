/**
 * Dry run for the brand claim engine (lib/brand-claims.ts).
 *
 * Reads nothing but the archive, writes nothing at all, and renders the
 * narrative every indexable brand would get. The point is to answer the only
 * question that matters before this touches a page: do 450 brands actually
 * produce 450 different paragraphs, or do we just get the old boilerplate
 * problem with fresher numbers?
 *
 * It reports:
 *   - how many claims fire per brand, by data tier
 *   - how many distinct claim SETS exist (the duplication measure)
 *   - how many distinct opening sentences exist (what a reader notices first)
 *   - which claims fire often enough to feel like boilerplate
 *   - claims that never fire (dead rules worth deleting or loosening)
 *   - word counts, and the worst near-duplicate pairs
 *
 * Run with:
 *   npx --yes tsx --conditions=react-server scripts/dry-run-brand-claims.ts
 *
 * Flags:
 *   --sample=<slug>   Print the full narrative for one brand and exit.
 *   --show=<n>        Print n full sample narratives (default 3).
 *   --page=<n>        Email page size. Lower it if PostgREST times out.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv();

import { getSupabaseAdmin } from "../lib/supabase-admin";
import { MIN_INDEXABLE_EMAILS } from "../lib/brand-summary";
import { NON_CAMPAIGN_CATEGORIES, type EmailCategory } from "../lib/admin-types";
import {
  buildBrandNarrative,
  claimBudget,
  CLAIMS,
  NARRATIVE_MIN_CAMPAIGNS,
  type BrandClaimFacts,
  type CategoryBenchmark
} from "../lib/brand-claims";

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const SAMPLE_SLUG = arg("sample");
const SHOW = Number(arg("show") ?? 3);
const PAGE = Number(arg("page") ?? 1000);

/**
 * Hour counts are expressed in UTC here. Production must decide on a stable
 * per-brand timezone (the brand page currently renders times in the viewer's
 * zone, which is fine for a chart but wrong for cached prose) — most likely the
 * brand's primary market. Until that decision lands, UTC keeps the dry run
 * honest rather than silently plausible.
 */
const TZ_LABEL = "UTC";

type RawEmail = {
  company_id: string;
  sent_at: string;
  subject: string | null;
  category: string | null;
  discount_percent: number | null;
  promo_code: string | null;
  offer_ends_on: string | null;
  offer_is_extension: boolean | null;
  esp_provider: string | null;
  preheader_padded: boolean | null;
  has_dark_mode: boolean | null;
  has_gif: boolean | null;
};

type Accumulator = {
  slug: string;
  name: string;
  category: string | null;
  sentAt: number[];
  days: Set<string>;
  subjects: Set<string>;
  mix: Map<string, number>;
  weekday: number[];
  hour: number[];
  discountCount: number;
  depths: Set<number>;
  maxDiscount: number | null;
  maxDiscountAt: string | null;
  promoCodes: number;
  deadlines: number;
  extensions: number;
  espCounts: Map<string, number>;
  padded: number;
  dark: number;
  gif: number;
};

async function main(): Promise<void> {
  const admin = getSupabaseAdmin();

  /* ---------------------------- brands ---------------------------------- */

  const { data: companies, error: companiesError } = await admin
    .from("companies")
    .select("id, name, slug, markets, company_email_stats(email_count)")
    .is("deleted_at", null);
  if (companiesError) throw companiesError;

  const brands = new Map<string, Accumulator>();
  for (const company of companies ?? []) {
    const stats = Array.isArray(company.company_email_stats)
      ? company.company_email_stats[0]
      : company.company_email_stats;
    if ((stats?.email_count ?? 0) < MIN_INDEXABLE_EMAILS) continue;
    const markets = (company.markets as string[] | null) ?? [];
    brands.set(company.id, {
      slug: company.slug,
      name: company.name,
      category: markets[0] ?? null,
      sentAt: [],
      days: new Set(),
      subjects: new Set(),
      mix: new Map(),
      weekday: Array(7).fill(0),
      hour: Array(24).fill(0),
      discountCount: 0,
      depths: new Set(),
      maxDiscount: null,
      maxDiscountAt: null,
      promoCodes: 0,
      deadlines: 0,
      extensions: 0,
      espCounts: new Map(),
      padded: 0,
      dark: 0,
      gif: 0
    });
  }
  console.log(`indexable brands: ${brands.size}`);

  /* ---------------------------- emails ---------------------------------- */

  let from = 0;
  let scanned = 0;
  for (;;) {
    const { data, error } = await admin
      .from("captured_emails")
      .select(
        "company_id, sent_at, subject, category, discount_percent, promo_code, offer_ends_on, offer_is_extension, esp_provider, preheader_padded, has_dark_mode, has_gif"
      )
      .is("duplicate_of", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as RawEmail[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const brand = brands.get(row.company_id);
      if (!brand) continue;
      const category = (row.category ?? "other") as EmailCategory;
      if (NON_CAMPAIGN_CATEGORIES.has(category)) continue;
      if (!row.sent_at) continue;

      const when = new Date(row.sent_at);
      if (Number.isNaN(when.getTime())) continue;

      scanned += 1;
      brand.sentAt.push(when.getTime());
      brand.days.add(when.toISOString().slice(0, 10));
      if (row.subject) brand.subjects.add(row.subject.trim().toLowerCase());
      brand.mix.set(category, (brand.mix.get(category) ?? 0) + 1);
      brand.weekday[when.getUTCDay()] += 1;
      brand.hour[when.getUTCHours()] += 1;

      const depth =
        row.discount_percent === null ? null : Number(row.discount_percent);
      if (depth !== null && Number.isFinite(depth) && depth > 0) {
        brand.discountCount += 1;
        brand.depths.add(depth);
        if (brand.maxDiscount === null || depth > brand.maxDiscount) {
          brand.maxDiscount = depth;
          brand.maxDiscountAt = row.sent_at;
        }
      }
      if (row.promo_code) brand.promoCodes += 1;
      if (row.offer_ends_on) brand.deadlines += 1;
      if (row.offer_is_extension) brand.extensions += 1;
      if (row.esp_provider) {
        brand.espCounts.set(
          row.esp_provider,
          (brand.espCounts.get(row.esp_provider) ?? 0) + 1
        );
      }
      if (row.preheader_padded) brand.padded += 1;
      if (row.has_dark_mode) brand.dark += 1;
      if (row.has_gif) brand.gif += 1;
    }

    from += PAGE;
    if (rows.length < PAGE) break;
  }
  console.log(`campaigns scanned: ${scanned}`);

  /* ---------------------------- facts ----------------------------------- */

  const facts: BrandClaimFacts[] = [];
  for (const brand of brands.values()) {
    if (brand.sentAt.length === 0) continue;
    const sorted = [...brand.sentAt].sort((a, b) => a - b);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const spanDays = Math.max(
      Math.round((last - first) / (1000 * 60 * 60 * 24)),
      1
    );
    const campaigns = brand.sentAt.length;
    const topEsp = [...brand.espCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    facts.push({
      slug: brand.slug,
      name: brand.name,
      category: brand.category,
      campaigns,
      spanDays,
      sendDays: brand.days.size,
      perWeek: (campaigns / spanDays) * 7,
      distinctSubjects: brand.subjects.size,
      mix: [...brand.mix.entries()]
        .map(([category, count]) => ({
          category: category as EmailCategory,
          count
        }))
        .sort((a, b) => b.count - a.count),
      weekdayCounts: brand.weekday,
      hourCounts: brand.hour,
      timezoneLabel: TZ_LABEL,
      discountCount: brand.discountCount,
      discountDepths: [...brand.depths].sort((a, b) => a - b),
      maxDiscount: brand.maxDiscount,
      maxDiscountAt: brand.maxDiscountAt,
      promoCodeCount: brand.promoCodes,
      deadlineCount: brand.deadlines,
      extensionCount: brand.extensions,
      esp: topEsp ? topEsp[0] : null,
      paddedShare: campaigns > 0 ? brand.padded / campaigns : 0,
      darkShare: campaigns > 0 ? brand.dark / campaigns : 0,
      gifShare: campaigns > 0 ? brand.gif / campaigns : 0,
      firstSend: new Date(first).toISOString()
    });
  }

  /* ---------------------------- benchmarks ------------------------------ */

  const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.min(Math.floor(p * s.length), s.length - 1)];
  };

  // Only brands with a real window contribute to a median. A brand with four
  // campaigns over two days would otherwise drag the category cadence upward.
  const eligible = (f: BrandClaimFacts) => f.campaigns >= 5 && f.spanDays >= 14;

  const byCategory = new Map<string, BrandClaimFacts[]>();
  for (const f of facts) {
    const key = f.category ?? "(none)";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(f);
  }

  const benchmarks = new Map<string, CategoryBenchmark>();
  const ranks = new Map<string, number>();
  for (const [category, members] of byCategory) {
    const pool = members.filter(eligible);
    const perWeeks = pool.map((f) => f.perWeek);
    const discountShares = pool.map((f) =>
      f.campaigns > 0 ? f.discountCount / f.campaigns : 0
    );
    const maxDiscounts = pool
      .map((f) => f.maxDiscount)
      .filter((d): d is number => d !== null);

    pool
      .slice()
      .sort((a, b) => b.perWeek - a.perWeek)
      .forEach((f, index) => ranks.set(f.slug, index + 1));

    benchmarks.set(category, {
      category,
      brands: pool.length,
      medianPerWeek: median(perWeeks),
      p90PerWeek: percentile(perWeeks, 0.9),
      rankPerWeek: null,
      medianDiscountShare: median(discountShares),
      medianMaxDiscount: maxDiscounts.length > 0 ? median(maxDiscounts) : null,
      shareThatDiscount:
        pool.length > 0
          ? pool.filter((f) => f.discountCount > 0).length / pool.length
          : 0
    });
  }

  const benchmarkFor = (f: BrandClaimFacts): CategoryBenchmark | null => {
    const base = benchmarks.get(f.category ?? "(none)");
    if (!base) return null;
    return { ...base, rankPerWeek: ranks.get(f.slug) ?? null };
  };

  /* ---------------------------- single sample --------------------------- */

  if (SAMPLE_SLUG) {
    const target = facts.find((f) => f.slug === SAMPLE_SLUG);
    if (!target) {
      console.error(`no indexable brand with slug "${SAMPLE_SLUG}"`);
      process.exit(1);
    }
    const bench = benchmarkFor(target);
    const narrative = buildBrandNarrative(target, bench);
    console.log(`\n=== ${target.name} (${target.slug}) ===`);
    console.log(
      `campaigns ${target.campaigns} · span ${target.spanDays}d · ${target.perWeek.toFixed(1)}/wk · budget ${claimBudget(target.campaigns)}`
    );
    if (bench) {
      console.log(
        `category "${bench.category}": ${bench.brands} brands · median ${bench.medianPerWeek.toFixed(2)}/wk · rank ${bench.rankPerWeek ?? "n/a"}`
      );
    }
    console.log("");
    narrative?.paragraphs.forEach((p) => console.log(`${p}\n`));
    console.log(`claims: ${narrative?.claimIds.join(", ")}`);
    console.log(`words: ${narrative?.wordCount}`);
    return;
  }

  /* ---------------------------- distribution ---------------------------- */

  type Row = {
    f: BrandClaimFacts;
    claimIds: string[];
    opening: string;
    words: number;
  };

  const rows: Row[] = [];
  const fireCounts = new Map<string, number>();
  let belowThreshold = 0;
  let empty = 0;

  for (const f of facts) {
    const bench = benchmarkFor(f);
    const narrative = buildBrandNarrative(f, bench);
    if (!narrative) {
      // Distinguish "held back on purpose" from "the engine had nothing",
      // because the first is the design working and the second is a bug.
      if (f.campaigns < NARRATIVE_MIN_CAMPAIGNS) belowThreshold += 1;
      else empty += 1;
      continue;
    }
    for (const id of narrative.claimIds) {
      fireCounts.set(id, (fireCounts.get(id) ?? 0) + 1);
    }
    rows.push({
      f,
      claimIds: narrative.claimIds,
      opening: narrative.paragraphs[0].split(/(?<=\.)\s/)[0],
      words: narrative.wordCount
    });
  }

  const tierOf = (campaigns: number) =>
    campaigns < 15 ? "thin (<15)" : campaigns < 40 ? "mid (15-39)" : "rich (40+)";

  console.log(`\n${"=".repeat(64)}`);
  console.log("CLAIM DISTRIBUTION");
  console.log("=".repeat(64));
  console.log(
    `brands rendered: ${rows.length}   held back (<${NARRATIVE_MIN_CAMPAIGNS} campaigns): ${belowThreshold}   unexpectedly empty: ${empty}`
  );

  // Distinct claim sets: the headline duplication measure. A claim set is the
  // sorted ids, so two brands collide only when they fire exactly the same
  // rules — which is the case where their paragraphs really do read alike.
  const setKey = (r: Row) => [...r.claimIds].sort().join("|");
  const distinctSets = new Set(rows.map(setKey));
  const distinctOpenings = new Set(rows.map((r) => r.opening));
  console.log(
    `distinct claim sets: ${distinctSets.size} / ${rows.length} (${((distinctSets.size / rows.length) * 100).toFixed(1)}% unique)`
  );
  console.log(
    `distinct opening sentences: ${distinctOpenings.size} / ${rows.length} (${((distinctOpenings.size / rows.length) * 100).toFixed(1)}% unique)`
  );

  console.log("\nby tier");
  for (const tier of ["thin (<15)", "mid (15-39)", "rich (40+)"]) {
    const group = rows.filter((r) => tierOf(r.f.campaigns) === tier);
    if (group.length === 0) continue;
    const sets = new Set(group.map(setKey));
    const avgClaims =
      group.reduce((sum, r) => sum + r.claimIds.length, 0) / group.length;
    const avgWords =
      group.reduce((sum, r) => sum + r.words, 0) / group.length;
    console.log(
      `  ${tier.padEnd(12)} brands ${String(group.length).padStart(3)}  ` +
        `distinct sets ${String(sets.size).padStart(3)} (${((sets.size / group.length) * 100).toFixed(0)}%)  ` +
        `avg claims ${avgClaims.toFixed(1)}  avg words ${avgWords.toFixed(0)}`
    );
  }

  console.log("\nclaim fire rate (share of rendered brands)");
  const sortedFires = [...fireCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [id, count] of sortedFires) {
    const pctFired = (count / rows.length) * 100;
    const flag = pctFired > 80 ? "  <-- near-universal, reads as boilerplate" : "";
    console.log(
      `  ${id.padEnd(30)} ${String(count).padStart(4)}  ${pctFired.toFixed(1).padStart(5)}%${flag}`
    );
  }

  const never = CLAIMS.filter((c) => !fireCounts.has(c.id)).map((c) => c.id);
  if (never.length > 0) {
    console.log(`\nnever fired (${never.length}): ${never.join(", ")}`);
  }

  // Largest collision groups: the brands whose pages would genuinely read alike.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = setKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const collisions = [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length);
  console.log(
    `\ncollision groups (identical claim sets): ${collisions.length}, largest ${collisions[0]?.length ?? 0} brands`
  );
  for (const group of collisions.slice(0, 5)) {
    console.log(
      `  ${group.length}x  ${group.map((r) => r.f.slug).slice(0, 6).join(", ")}${group.length > 6 ? ", …" : ""}`
    );
  }

  const words = rows.map((r) => r.words).sort((a, b) => a - b);
  console.log(
    `\nwords: min ${words[0]} · median ${words[Math.floor(words.length / 2)]} · max ${words[words.length - 1]}`
  );

  /* ---------------------------- samples --------------------------------- */

  console.log(`\n${"=".repeat(64)}`);
  console.log("SAMPLES");
  console.log("=".repeat(64));

  // One from each tier, plus whatever else fits, so the output shows the thin
  // case (where this is most likely to embarrass us) and not just the best one.
  const picks: Row[] = [];
  for (const tier of ["rich (40+)", "mid (15-39)"]) {
    const found = rows
      .filter((r) => tierOf(r.f.campaigns) === tier)
      .sort((a, b) => b.claimIds.length - a.claimIds.length)[0];
    if (found) picks.push(found);
  }

  for (const row of picks.slice(0, SHOW)) {
    const bench = benchmarkFor(row.f);
    const narrative = buildBrandNarrative(row.f, bench);
    console.log(
      `\n--- ${row.f.name} (${row.f.slug}) · ${row.f.campaigns} campaigns · ${tierOf(row.f.campaigns)} ---`
    );
    narrative?.paragraphs.forEach((p) => console.log(`${p}\n`));
    console.log(`[${row.claimIds.join(", ")}] ${row.words} words`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
