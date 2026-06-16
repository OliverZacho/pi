"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  HERO_EMAIL_FERM as FERM_EMAIL,
  HERO_ANALYTICS_FERM as FERM_ANALYTICS,
} from "@/lib/marketing/hero-data";
import { formatShortDate, formatTime } from "@/lib/datetime";
import styles from "./home-sections.module.css";

/**
 * Interactive teardown. A real email on the left; on the right, what Pirol
 * *knows* about the brand behind it — this email's signals woven with the
 * brand's whole-history aggregates (send-hour concentration, weekly cadence,
 * discount habit, ESP share, category mix) and a cohort comparison.
 *
 * The default (Ferm Living) carries baked-but-real numbers so it's instant.
 * "Show me another" pulls LIVE emails from the curated allow-list and
 * lazy-loads each brand's real aggregates from `/api/explore/brand-insight`.
 */

type Figures = {
  hourly: number[];
  categories: { label: string; share: number }[];
  ctas: { text: string; share: number }[];
  palette: { hex: string; count: number }[];
  fonts: { family: string; count: number }[];
  weeklyDiscounts: { sends: number; discountSends: number; avgDepth: number }[];
  espCohort: {
    brands: number;
    scope: string;
    items: { label: string; count: number; isThis: boolean }[];
  } | null;
};

type Insight = {
  emailCount: number;
  perWeek: number;
  benchmarkPerWeek: number | null;
  benchmarkLabel: string;
  typicalHour: { label: string; share: number } | null;
  esp: { label: string; share: number } | null;
  discountShare: number;
  avgDiscount: number | null;
  maxDiscount: number | null;
  topCategory: { label: string; share: number } | null;
  topCta: { text: string; share: number; distinct: number } | null;
  gifShare: number;
  darkModeShare: number;
  figures: Figures;
};

type EmailFacts = {
  sendTime: string;
  category: string;
  discount: number | null;
  cta: string | null;
  palette: string[];
  fonts: string[];
  flags: string[];
};

type Example = {
  brandName: string;
  initial: string;
  domain: string;
  dateLabel: string;
  subject: string;
  renderUrl: string;
  companyId: string | null;
  facts: EmailFacts;
  baked?: Insight;
};

type LiveEmail = {
  id: string;
  companyId: string | null;
  brandName: string;
  domain: string | null;
  subject: string;
  receivedAt: string;
  category: string;
  discountPercent: number | null;
  palette: string[];
  fonts: string[];
  hasGif: boolean;
  hasDarkMode: boolean;
  imageCount: number | null;
  ctaText: string | null;
  renderUrl: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  sale: "Sale",
  product_launch: "Product launch",
  products: "Products",
  event: "Event",
  content: "Content",
  education: "Education",
  loyalty: "Loyalty",
  welcome: "Welcome",
  seasonal: "Seasonal",
  company_news: "Company news",
  transactional: "Transactional",
};

const round1 = (x: number) => Math.round(x * 10) / 10;

function cleanDomain(d: string | null): string {
  if (!d) return "";
  return d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function fmtDate(iso: string): string {
  const date = formatShortDate(iso, { fallback: "" });
  const time = formatTime(iso, { fallback: "" });
  return [date, time].filter(Boolean).join(" · ");
}

// ---- Default example: Ferm Living. Its real aggregates + figures are fetched
// from /brand-insight like the live ones (the email render already streams in,
// so the brief insight fetch fits the same loading rhythm). ----
const FERM_COMPANY_ID = "72ce1372-020d-4476-b5c8-5be1bacd3444";

const FERM_EXAMPLE: Example = {
  brandName: FERM_EMAIL.brand.name,
  initial: "F",
  domain: FERM_EMAIL.brand.domain,
  dateLabel: "14 May · 08:00",
  subject: FERM_EMAIL.subject,
  renderUrl: `/api/explore/emails/${FERM_EMAIL.id}/render`,
  companyId: FERM_COMPANY_ID,
  facts: {
    sendTime: "08:00",
    category: "Sale",
    discount: null,
    cta: FERM_EMAIL.cta.label,
    // The default email's own pixel-extracted palette (same source as live
    // examples) — cream, greens and clay from the Free-Shipping hero.
    palette: ["#f8f5f0", "#488877", "#765936", "#a98b65", "#287967", "#563926"],
    // Ferm's real extracted brand face (web-safe fallbacks filtered out).
    fonts: ["KHTeka"],
    flags: [`${FERM_ANALYTICS.signals.imageCount} images`],
  },
};

function buildLiveExample(e: LiveEmail): Example {
  const flags: string[] = [];
  if (e.hasGif) flags.push("GIF");
  if (e.hasDarkMode) flags.push("Dark mode");
  if (e.imageCount != null) flags.push(`${e.imageCount} images`);

  return {
    brandName: e.brandName,
    initial: e.brandName.trim().charAt(0).toUpperCase() || "?",
    domain: cleanDomain(e.domain),
    dateLabel: fmtDate(e.receivedAt),
    subject: e.subject,
    renderUrl: e.renderUrl,
    companyId: e.companyId,
    facts: {
      sendTime: formatTime(e.receivedAt, { fallback: "—" }),
      category: CATEGORY_LABELS[e.category] ?? e.category,
      discount: e.discountPercent,
      cta: e.ctaText,
      palette: e.palette,
      fonts: e.fonts,
      flags,
    },
  };
}

const MAX_LIVE = 5;

export default function BrandTeardown() {
  const [live, setLive] = useState<Example[]>([]);
  const [index, setIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [insights, setInsights] = useState<Record<string, Insight | null>>({});
  const [insightLoading, setInsightLoading] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  // Close any open drill-down figure when the email changes.
  useEffect(() => {
    setOpenRow(null);
  }, [index]);

  const current = index === -1 ? FERM_EXAMPLE : live[index];
  const cid = current.companyId;
  const insight: Insight | null =
    current.baked ?? (cid ? insights[cid] ?? null : null);
  const insightPending = !!cid && !current.baked && insights[cid] === undefined;

  // Lazy-load brand aggregates for the current (live) email.
  useEffect(() => {
    if (!cid || current.baked || insights[cid] !== undefined) return;
    let cancelled = false;
    setInsightLoading(true);
    fetch(`/api/explore/brand-insight?companyId=${cid}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setInsights((prev) => ({ ...prev, [cid]: d.insight ?? null }));
      })
      .catch(() => {
        if (!cancelled) setInsights((prev) => ({ ...prev, [cid]: null }));
      })
      .finally(() => {
        if (!cancelled) setInsightLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cid, current.baked, insights]);

  async function showAnother() {
    if (live.length > 0) {
      const next = index + 1;
      if (next >= Math.min(live.length, MAX_LIVE)) {
        setExhausted(true);
        return;
      }
      setIndex(next);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/explore/curated-emails");
      const data = await res.json();
      const examples: Example[] = (data.items ?? []).slice(0, MAX_LIVE).map(buildLiveExample);
      if (examples.length === 0) {
        setExhausted(true);
        return;
      }
      setLive(examples);
      setIndex(0);
    } catch {
      setExhausted(true);
    } finally {
      setLoading(false);
    }
  }

  const showSkeleton = insightPending || (insightLoading && !insight);

  return (
    <section className={styles.teardownSection} aria-labelledby="teardown-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>A look inside</p>
        <h2 id="teardown-title" className={styles.sectionTitle}>
          Read an email the way Pirol does.
        </h2>
        <p className={styles.sectionLede}>
          Not just one email — the whole brand behind it. Pull a fresh one and
          watch Pirol read its full sending pattern in real time.
        </p>
      </div>

      <div className={styles.interactive}>
        {/* the email — clean, no overlay */}
        <div className={styles.emailFrame}>
          <div className={styles.emailClient}>
            <div className={styles.emailSenderRow}>
              <span className={styles.emailAvatar} aria-hidden="true">
                {current.initial}
              </span>
              <div className={styles.emailFromBlock}>
                <span className={styles.emailFromName}>{current.brandName}</span>
                {current.domain && (
                  <span className={styles.emailFromAddr}>{current.domain}</span>
                )}
              </div>
              <span className={styles.emailTimestamp}>{current.dateLabel}</span>
            </div>
            <div className={styles.emailToLine}>
              To: <span>you@studio.dk</span>
            </div>
            <h4 className={styles.emailSubjectLine}>{current.subject}</h4>
          </div>

          <div className={styles.emailBody}>
            <EmailRender renderUrl={current.renderUrl} />
          </div>
        </div>

        {/* what Pirol knows */}
        <div className={styles.spec} aria-live="polite">
          <p className={styles.specTitle}>
            What Pirol knows{" "}
            <span className={styles.specBrand}>· {current.brandName}</span>
          </p>

          {showSkeleton ? (
            <SpecSkeleton brand={current.brandName} />
          ) : openRow && insight ? (
            <RowDetail
              signal={openRow}
              insight={insight}
              facts={current.facts}
              brandName={current.brandName}
              onBack={() => setOpenRow(null)}
            />
          ) : (
            <div className={styles.specBody} key={`${index}-${insight ? 1 : 0}`}>
              {insight && (
                <div className={styles.specHeadline}>
                  <span className={styles.specHeadNum}>
                    {insight.perWeek}
                    <span className={styles.specHeadUnit}>emails / week</span>
                  </span>
                  <span className={styles.specHeadSub}>{cadenceCompare(insight)}</span>
                </div>
              )}

              <div className={styles.specList}>
                <SpecRow
                  i={0}
                  id="sendtime"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Send time"
                  main={current.facts.sendTime}
                  ctx={
                    insight?.typicalHour
                      ? `usually ~${insight.typicalHour.label} · ${insight.typicalHour.share}% of sends`
                      : undefined
                  }
                />
                <SpecRow
                  i={1}
                  id="platform"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Platform"
                  main={
                    insight?.esp ? (
                      <span className={styles.specBadge}>{insight.esp.label}</span>
                    ) : (
                      <span className={styles.specMuted}>not detected</span>
                    )
                  }
                  ctx={insight?.esp ? `on ${insight.esp.share}% of their sends` : undefined}
                />
                <SpecRow
                  i={2}
                  id="discounts"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Discounts"
                  main={
                    current.facts.discount != null
                      ? `This send: ${current.facts.discount}% off`
                      : insight && insight.discountShare > 0
                        ? `${insight.discountShare}% of sends carry one`
                        : insight
                          ? "Rarely discounts"
                          : "No discount"
                  }
                  ctx={
                    insight && insight.discountShare > 0
                      ? current.facts.discount != null
                        ? `they discount ${insight.discountShare}% of the time · avg ${insight.avgDiscount}% · deepest ${insight.maxDiscount}%`
                        : `avg ${insight.avgDiscount}% · deepest ${insight.maxDiscount}%`
                      : undefined
                  }
                />
                <SpecRow
                  i={3}
                  id="content"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Content"
                  main={current.facts.category}
                  ctx={
                    insight?.topCategory
                      ? `mostly ${insight.topCategory.label} (${insight.topCategory.share}% of their mix)`
                      : undefined
                  }
                />
                <SpecRow
                  i={4}
                  id="cta"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Call to action"
                  main={
                    current.facts.cta ? (
                      `“${current.facts.cta}”`
                    ) : (
                      <span className={styles.specMuted}>none surfaced</span>
                    )
                  }
                  ctx={
                    insight?.topCta
                      ? `their go-to: “${insight.topCta.text}” · ${insight.topCta.share}% of sends`
                      : undefined
                  }
                />
                <SpecRow
                  i={5}
                  id="design"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Design"
                  main={
                    current.facts.flags.length ? (
                      <span className={styles.specChips}>
                        {current.facts.flags.map((f) => (
                          <span key={f} className={styles.specChip}>
                            {f}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className={styles.specMuted}>plain</span>
                    )
                  }
                  ctx={
                    insight
                      ? `GIF on ${insight.gifShare}% of sends · ${
                          insight.darkModeShare > 0
                            ? `dark-mode ${insight.darkModeShare}%`
                            : "never dark-mode"
                        }`
                      : undefined
                  }
                />
                <SpecRow
                  i={6}
                  id="palette"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Palette"
                  main={
                    current.facts.palette.length ? (
                      <span className={styles.specSwatches}>
                        {current.facts.palette.map((hex) => (
                          <span
                            key={hex}
                            className={styles.specSwatch}
                            style={{ background: hex }}
                            title={hex}
                          />
                        ))}
                      </span>
                    ) : (
                      <span className={styles.specMuted}>—</span>
                    )
                  }
                />
                <SpecRow
                  i={7}
                  id="fonts"
                  onOpen={insight ? setOpenRow : undefined}
                  k="Fonts"
                  main={
                    current.facts.fonts.length ? (
                      <span className={styles.specChips}>
                        {current.facts.fonts.map((f) => (
                          <span key={f} className={styles.fontChip}>
                            {f}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className={styles.specMuted}>—</span>
                    )
                  }
                />
              </div>

              {insight && (
                <p className={styles.specFoot}>
                  From {insight.emailCount} captured sends — and counting.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* live-fetch control */}
      <div className={styles.teardownControls}>
        {exhausted ? (
          <div className={styles.fetchLimit} role="status">
            <p className={styles.fetchLimitTitle}>That&rsquo;s the preview — {MAX_LIVE} emails.</p>
            <p className={styles.fetchLimitBody}>
              The archive holds thousands more, from every brand we track —
              broken down exactly like this.
            </p>
            <div className={styles.fetchLimitCtas}>
              <Link href="/pricing" className={styles.fetchBtn}>
                See plans →
              </Link>
              <Link href="/explore" className={styles.fetchLimitLink}>
                Browse the archive
              </Link>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={styles.fetchBtn}
              onClick={showAnother}
              disabled={loading}
            >
              {loading
                ? "Fetching a live email…"
                : index === -1
                  ? "Show me a live one →"
                  : "Show me another →"}
            </button>
            <span className={styles.fetchNote}>
              {index === -1
                ? "Featured example"
                : `Live email ${index + 1} of ${Math.min(live.length, MAX_LIVE)} · pulled from highlighted brands just now`}
            </span>
          </>
        )}
      </div>

      {/* a light step into comparison + collections */}
      <div className={styles.nextUp}>
        <Link href="/features/comparisons" className={styles.nextCard}>
          <span className={styles.nextKicker}>Go wider</span>
          <span className={styles.nextTitle}>Put up to 6 brands side by side</span>
          <span className={styles.nextBody}>
            Who sends most, when they go quiet, how deep discounts run, and what
            they talk about — one dashboard.
          </span>
          <span className={styles.nextLink}>How comparisons work →</span>
        </Link>
        <Link href="/features/collections" className={styles.nextCard}>
          <span className={styles.nextKicker}>Keep it</span>
          <span className={styles.nextTitle}>Collect a theme across every brand</span>
          <span className={styles.nextBody}>
            Set a rule — “Sale · 40%+ off · Denmark” — and Pirol fills a
            shareable board for you, automatically.
          </span>
          <span className={styles.nextLink}>How collections work →</span>
        </Link>
      </div>

      <p className={styles.teardownFootnote}>
        Real captured emails and real aggregates from the archive — the depth
        grows as more lands.{" "}
        <Link href="/explore" className={styles.inlineLink}>
          Explore the rest →
        </Link>
      </p>
    </section>
  );
}

function cadenceCompare(insight: Insight): string {
  if (insight.benchmarkPerWeek == null) {
    return `across ${insight.emailCount} captured sends`;
  }
  const r = insight.perWeek / insight.benchmarkPerWeek;
  if (r >= 1.2) return `${round1(r)}× more than ${insight.benchmarkLabel}`;
  if (r <= 0.83) return `below ${insight.benchmarkLabel} (${insight.benchmarkPerWeek}/wk)`;
  return `about the same as ${insight.benchmarkLabel}`;
}

function SpecRow({
  i,
  id,
  k,
  main,
  ctx,
  onOpen,
}: {
  i: number;
  id?: string;
  k: string;
  main: React.ReactNode;
  ctx?: string;
  onOpen?: (id: string) => void;
}) {
  const clickable = !!(onOpen && id);
  const inner = (
    <>
      <span className={styles.specKey}>{k}</span>
      <span className={styles.specVal}>
        <span className={styles.specValMain}>{main}</span>
        {ctx && <span className={styles.specValCtx}>{ctx}</span>}
      </span>
      {clickable && (
        <span className={styles.specChevron} aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
  const style = { animationDelay: `${i * 55}ms` };
  if (clickable) {
    return (
      <button
        type="button"
        className={`${styles.specRow} ${styles.specRowBtn}`}
        style={style}
        onClick={() => onOpen!(id!)}
        aria-label={`See the figure for ${k}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={styles.specRow} style={style}>
      {inner}
    </div>
  );
}

function SpecSkeleton({ brand }: { brand: string }) {
  return (
    <div className={styles.specSkel}>
      <p className={styles.specSkelNote}>Reading {brand}&rsquo;s full history…</p>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={styles.specSkelRow} style={{ animationDelay: `${i * 90}ms` }}>
          <span className={styles.specSkelKey} />
          <span className={styles.specSkelVal} />
        </div>
      ))}
    </div>
  );
}

/* ===================== drill-down figures ===================== */

const ACCENT = "#0f766e";
const SIGNAL_TITLES: Record<string, string> = {
  sendtime: "When they send",
  platform: "Platform — and the field",
  discounts: "Discount rhythm · last 10 weeks",
  content: "What they send",
  cta: "Their CTA habits",
  design: "Design signals",
  palette: "Their palette",
  fonts: "Their type",
};

function RowDetail({
  signal,
  insight,
  facts,
  brandName,
  onBack,
}: {
  signal: string;
  insight: Insight;
  facts: EmailFacts;
  brandName: string;
  onBack: () => void;
}) {
  const f = insight.figures;
  let body: React.ReactNode = null;
  if (signal === "sendtime") body = <ClockFigure hourly={f.hourly} typical={insight.typicalHour} />;
  else if (signal === "platform") body = <EspFigure cohort={f.espCohort} esp={insight.esp} />;
  else if (signal === "discounts") body = <DiscountFigure weeks={f.weeklyDiscounts} insight={insight} />;
  else if (signal === "content")
    body = <BarsFigure items={f.categories.map((c) => ({ label: c.label, value: c.share }))} highlight={facts.category} />;
  else if (signal === "cta")
    body = <BarsFigure items={f.ctas.map((c) => ({ label: c.text, value: c.share }))} highlight={facts.cta ?? undefined} />;
  else if (signal === "design") body = <DesignFigure insight={insight} />;
  else if (signal === "palette") body = <PaletteFigure palette={f.palette} />;
  else if (signal === "fonts") body = <FontsFigure fonts={f.fonts} />;

  return (
    <div className={styles.detail}>
      <button type="button" className={styles.detailBack} onClick={onBack}>
        ‹ Back
      </button>
      <p className={styles.detailTitle}>{SIGNAL_TITLES[signal]}</p>
      <div className={styles.detailFig}>{body}</div>
      <p className={styles.detailFoot}>{brandName} · from {insight.emailCount} captured sends</p>
    </div>
  );
}

/* --- SVG helpers --- */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function annular(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number) {
  const [x0o, y0o] = polar(cx, cy, rO, a0);
  const [x1o, y1o] = polar(cx, cy, rO, a1);
  const [x1i, y1i] = polar(cx, cy, rI, a1);
  const [x0i, y0i] = polar(cx, cy, rI, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0o} ${y0o}A${rO} ${rO} 0 ${large} 1 ${x1o} ${y1o}L${x1i} ${y1i}A${rI} ${rI} 0 ${large} 0 ${x0i} ${y0i}Z`;
}

/** AM/PM heat-clock of hourly send volume. */
function ClockFigure({ hourly, typical }: { hourly: number[]; typical: Insight["typicalHour"] }) {
  const max = Math.max(1, ...hourly);
  const clock = (offset: number, cx: number, label: string) => (
    <g>
      {Array.from({ length: 12 }).map((_, h) => {
        const count = hourly[offset + h] ?? 0;
        const op = count > 0 ? 0.14 + 0.86 * (count / max) : 0.05;
        return (
          <path key={h} d={annular(cx, 95, 80, 40, h * 30, h * 30 + 30)} fill={ACCENT} fillOpacity={op}>
            <title>{`${(offset + h) % 24}:00 — ${count} sends`}</title>
          </path>
        );
      })}
      <circle cx={cx} cy={95} r={80} fill="none" stroke="rgba(11,11,12,0.1)" />
      <circle cx={cx} cy={95} r={40} fill="#fff" stroke="rgba(11,11,12,0.1)" />
      <text x={cx} y={99} className={styles.clockCenter}>{label}</text>
    </g>
  );
  return (
    <div>
      <svg viewBox="0 0 360 200" className={styles.figSvg} role="img" aria-label="Hourly send-time clock">
        {clock(0, 96, "AM")}
        {clock(12, 264, "PM")}
      </svg>
      {typical && (
        <p className={styles.figNote}>
          Peak slot <strong>~{typical.label}</strong> — {typical.share}% of all their sends.
        </p>
      )}
    </div>
  );
}

/** Top ESPs across the brand's cohort, the brand's own highlighted. */
function EspFigure({
  cohort,
  esp,
}: {
  cohort: Figures["espCohort"];
  esp: Insight["esp"];
}) {
  if (!cohort) {
    return (
      <p className={styles.figNote}>
        Sends with <strong>{esp?.label ?? "an undetected ESP"}</strong>
        {esp ? ` on ${esp.share}% of their sends.` : "."}
      </p>
    );
  }
  const max = Math.max(1, ...cohort.items.map((i) => i.count));
  return (
    <div>
      <p className={styles.figCaption}>Most-used ESPs across {cohort.scope}</p>
      <div className={styles.barList}>
        {cohort.items.map((it) => (
          <div key={it.label} className={styles.barRow}>
            <span className={`${styles.barLabel} ${it.isThis ? styles.barLabelMe : ""}`}>{it.label}</span>
            <span className={styles.barTrack}>
              <span
                className={styles.barFill}
                style={{ width: `${(it.count / max) * 100}%`, opacity: it.isThis ? 1 : 0.4 }}
              />
            </span>
            <span className={styles.barVal}>{Math.round((100 * it.count) / cohort.brands)}%</span>
          </div>
        ))}
      </div>
      <p className={styles.figNote}>
        This brand uses <strong>{esp?.label}</strong> — highlighted above.
      </p>
    </div>
  );
}

/** Weekly discount frequency + depth. */
function DiscountFigure({ weeks, insight }: { weeks: Figures["weeklyDiscounts"]; insight: Insight }) {
  const maxDepth = Math.max(10, ...weeks.map((w) => w.avgDepth));
  return (
    <div>
      <div className={styles.weekBars}>
        {weeks.map((w, i) => {
          const has = w.discountSends > 0;
          return (
            <div key={i} className={styles.weekCol} title={`${w.discountSends}/${w.sends} sends discounted · avg ${w.avgDepth}%`}>
              <div className={styles.weekBarWrap}>
                <span
                  className={styles.weekBar}
                  style={{ height: `${has ? Math.max(8, (w.avgDepth / maxDepth) * 100) : 0}%`, opacity: has ? 1 : 0.15 }}
                />
              </div>
              <span className={styles.weekDot} data-on={has ? "1" : "0"} />
            </div>
          );
        })}
      </div>
      <div className={styles.weekAxis}>
        <span>10 wks ago</span>
        <span>now</span>
      </div>
      <p className={styles.figNote}>
        Discounts on <strong>{insight.discountShare}%</strong> of sends · avg{" "}
        <strong>{insight.avgDiscount ?? 0}%</strong> · deepest <strong>{insight.maxDiscount ?? 0}%</strong>. Bar height = that week&rsquo;s average depth.
      </p>
    </div>
  );
}

/** Generic ranked horizontal bars (content mix, CTAs). */
function BarsFigure({ items, highlight }: { items: { label: string; value: number }[]; highlight?: string }) {
  if (!items.length) return <p className={styles.figNote}>Not enough data yet.</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={styles.barList}>
      {items.map((it) => {
        const me = highlight && it.label.toLowerCase() === highlight.toLowerCase();
        return (
          <div key={it.label} className={styles.barRow}>
            <span className={`${styles.barLabel} ${me ? styles.barLabelMe : ""}`} title={it.label}>{it.label}</span>
            <span className={styles.barTrack}>
              <span className={styles.barFill} style={{ width: `${(it.value / max) * 100}%`, opacity: me ? 1 : 0.55 }} />
            </span>
            <span className={styles.barVal}>{it.value}%</span>
          </div>
        );
      })}
    </div>
  );
}

/** GIF + dark-mode adoption gauges. */
function DesignFigure({ insight }: { insight: Insight }) {
  const gauge = (label: string, v: number) => (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <span className={styles.barTrack}>
        <span className={styles.barFill} style={{ width: `${v}%` }} />
      </span>
      <span className={styles.barVal}>{v}%</span>
    </div>
  );
  return (
    <div>
      <div className={styles.barList}>
        {gauge("Animated GIF", insight.gifShare)}
        {gauge("Dark-mode ready", insight.darkModeShare)}
      </div>
      <p className={styles.figNote}>Share of this brand&rsquo;s sends that use each.</p>
    </div>
  );
}

/** Brand palette as proportional swatches. */
function PaletteFigure({ palette }: { palette: Figures["palette"] }) {
  if (!palette.length) return <p className={styles.figNote}>No palette extracted yet.</p>;
  const total = palette.reduce((s, p) => s + p.count, 0) || 1;
  return (
    <div>
      <div className={styles.paletteStrip}>
        {palette.map((p) => (
          <span
            key={p.hex}
            className={styles.paletteSeg}
            style={{ background: p.hex, flexGrow: p.count }}
            title={`${p.hex} · ${Math.round((100 * p.count) / total)}%`}
          />
        ))}
      </div>
      <div className={styles.paletteGrid}>
        {palette.slice(0, 6).map((p) => (
          <span key={p.hex} className={styles.paletteChip}>
            <span className={styles.paletteDot} style={{ background: p.hex }} />
            {p.hex}
          </span>
        ))}
      </div>
      <p className={styles.figNote}>Most-used colours across all their emails, sized by frequency.</p>
    </div>
  );
}

/** Brand fonts with a live preview. */
function FontsFigure({ fonts }: { fonts: Figures["fonts"] }) {
  if (!fonts.length) return <p className={styles.figNote}>No fonts extracted yet.</p>;
  const max = Math.max(1, ...fonts.map((f) => f.count));
  return (
    <div className={styles.fontList}>
      {fonts.map((f) => (
        <div key={f.family} className={styles.fontRow}>
          <span className={styles.fontPreview} style={{ fontFamily: `'${f.family}', Georgia, serif` }}>
            Aa
          </span>
          <span className={styles.fontMeta}>
            <span className={styles.fontName}>{f.family}</span>
            <span className={styles.fontTrack}>
              <span className={styles.fontFill} style={{ width: `${(f.count / max) * 100}%` }} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders a real captured email through the public render endpoint: the iframe
 * is laid out at 600px wide and CSS-scaled down to fit the card (keeping the
 * email's own media queries intact), then sized to the email's true height so
 * the body becomes a scrollable preview of the whole thing.
 */
// Most marketing emails are designed at ≤640px wide, so start there; if an
// email is actually wider we measure it once on load and widen to fit (capped),
// so nothing ever clips. The canvas is then scaled to the card width.
const RENDER_WIDTH = 640;
const MAX_RENDER_WIDTH = 820;

function EmailRender({ renderUrl }: { renderUrl: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const aliveRef = useRef(true);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const [contentWidth, setContentWidth] = useState(RENDER_WIDTH);
  const [docHeight, setDocHeight] = useState(1100);
  const [loaded, setLoaded] = useState(false);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const recompute = () => {
      const w = el.clientWidth;
      if (w > 0) setViewportWidth(w);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset when the email changes — including scrolling back to the top.
  useEffect(() => {
    setLoaded(false);
    setContentWidth(RENDER_WIDTH);
    setDocHeight(1100);
    setAtBottom(false);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [renderUrl]);

  // Recompute the "more below" affordance whenever geometry changes.
  useEffect(() => {
    const el = viewportRef.current;
    if (el) setAtBottom(el.scrollHeight <= el.clientHeight + 4);
  }, [viewportWidth, contentWidth, docHeight, loaded]);

  // Measure the email's height (so it's fully scrollable) and neutralise its
  // canvas colour — the body plus the common ESP full-width wrappers — so a
  // too-narrow email sits on our white frame instead of showing its own
  // (often grey) page background. Only the outer canvas is reset; the email's
  // own content cards keep their backgrounds.
  function measure() {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !aliveRef.current) return;
    if (!doc.getElementById("pirol-bg-reset")) {
      const s = doc.createElement("style");
      s.id = "pirol-bg-reset";
      s.textContent =
        "html,body,#bodytable,#bodyTable,#bodyCell,.root-container,.es-wrapper,.es-wrapper-color{background-color:transparent !important;}";
      (doc.head || doc.documentElement).appendChild(s);
    }
    const root = doc.documentElement;
    const body = doc.body;
    const w = Math.min(
      MAX_RENDER_WIDTH,
      Math.max(root?.scrollWidth ?? 0, body?.scrollWidth ?? 0)
    );
    const h = Math.max(root?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
    // Only ever widen past the 640 base (avoids a measure→reflow→measure loop).
    if (w > 0) setContentWidth((prev) => (w > prev + 2 ? w : prev));
    if (h > 0) setDocHeight(h);
  }

  function onLoad() {
    setLoaded(true);
    measure();
    // Re-measure as remote images load and reflow the email.
    [200, 600, 1400].forEach((d) =>
      window.setTimeout(() => {
        if (aliveRef.current) measure();
      }, d)
    );
  }

  function onScroll() {
    const el = viewportRef.current;
    if (el) setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  }

  const scale = viewportWidth != null ? viewportWidth / contentWidth : null;
  const sizerHeight = scale != null ? Math.round(docHeight * scale) : undefined;

  return (
    <div className={styles.renderRoot}>
      <div className={styles.renderViewport} ref={viewportRef} onScroll={onScroll}>
        {!loaded && (
          <div className={styles.renderSkeleton} aria-hidden="true">
            Rendering the email…
          </div>
        )}
        <div className={styles.renderSizer} style={{ height: sizerHeight }}>
          <iframe
            key={renderUrl}
            ref={frameRef}
            src={renderUrl}
            title="Captured email"
            referrerPolicy="no-referrer"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            className={styles.renderFrame}
            style={
              scale != null
                ? { transform: `scale(${scale})`, width: `${contentWidth}px`, height: `${docHeight}px` }
                : { visibility: "hidden" }
            }
            onLoad={onLoad}
          />
        </div>
      </div>
      {loaded && !atBottom && <div className={styles.renderFade} aria-hidden="true" />}
    </div>
  );
}
