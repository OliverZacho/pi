"use client";

/* =================================================================
   Shared marketing miniatures — faithful, fake-data reproductions of
   the real product visuals, used by both the homepage feature band
   and the /features/* deep-dive pages. Colours and geometry are
   lifted verbatim from the app components (BrandClockHeatmap,
   BrandDiscountTimeline, CollectionRulesEditor, CompareDashboard,
   CollectionEventInsights, FollowingClient) so the posters read as
   the product, not a mockup.

   Animations key off an ancestor's [data-reveal="in"] attribute —
   wrap these in a `useReveal`-driven container (see FeaturePoster).

   IMPORTANT: every brand named in a fake-data visual (Fenne, Askvik,
   Kalvig, Brendholt) is FICTIONAL. Never attribute invented numbers —
   cadence, discounts, send times — to a real brand; real names may only
   appear next to genuinely captured data (e.g. LibraryShowcase, whose
   thumbnails are real emails).
   ================================================================= */

import styles from "./feature-bento.module.css";

/* -----------------------------------------------------------------
   Brand insight — send-hours clock pair
   ----------------------------------------------------------------- */

// A design brand's send-hour signature: a morning wave peaking ~10am.
const HOURLY: number[] = [
  0, 0, 0, 0, 0, 0, 1, 3, 9, 14, 18, 11, 4, 2, 1, 3, 2, 1, 0, 1, 0, 0, 0, 0
];

// A warm Scandinavian palette (charcoal, olive, terracotta, linen).
export const BRAND_PALETTE = [
  "#1A1A1A",
  "#5E6E4A",
  "#B86F4C",
  "#C8B594",
  "#F4EFE3"
];

const CX = 100;
const CY = 100;
const R_OUTER = 86;
const R_INNER = 42;
const CARDINALS: Array<{ pos: number; label: string }> = [
  { pos: 0, label: "12" },
  { pos: 3, label: "3" },
  { pos: 6, label: "6" },
  { pos: 9, label: "9" }
];

function polar(r: number, clockDeg: number) {
  const rad = ((clockDeg - 90) * Math.PI) / 180;
  return {
    x: snap(CX + r * Math.cos(rad)),
    y: snap(CY + r * Math.sin(rad))
  };
}

function snap(v: number) {
  return Math.round(v * 1e4) / 1e4;
}

function annularPath(a1: number, a2: number) {
  const os = polar(R_OUTER, a1);
  const oe = polar(R_OUTER, a2);
  const is = polar(R_INNER, a1);
  const ie = polar(R_INNER, a2);
  return [
    `M ${os.x} ${os.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 0 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${R_INNER} ${R_INNER} 0 0 0 ${is.x} ${is.y}`,
    "Z"
  ].join(" ");
}

function ClockFace({
  label,
  hours
}: {
  label: string;
  hours: number[];
}) {
  const max = Math.max(1, ...HOURLY);
  return (
    <div className={styles.clockWrap}>
      <svg
        viewBox="0 0 200 200"
        className={styles.clockSvg}
        role="img"
        aria-label={`${label} send hours`}
      >
        <circle cx={CX} cy={CY} r={R_OUTER} className={styles.clockRing} />
        {hours.map((count, i) => {
          const a1 = (i - 0.5) * 30;
          const a2 = (i + 0.5) * 30;
          const intensity = count / max;
          const opacity = count === 0 ? 0.05 : 0.18 + intensity * 0.82;
          return (
            <path
              key={i}
              d={annularPath(a1, a2)}
              className={styles.clockWedge}
              fillOpacity={opacity}
              style={{ ["--d" as string]: i }}
            />
          );
        })}
        {CARDINALS.map(({ pos, label: hourLabel }) => {
          const p = polar(99, pos * 30);
          return (
            <text
              key={pos}
              x={p.x}
              y={p.y}
              className={styles.clockHourLabel}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {hourLabel}
            </text>
          );
        })}
        <circle cx={CX} cy={CY} r={R_INNER - 3} className={styles.clockHub} />
        <text
          x={CX}
          y={CY}
          className={styles.clockCenterLabel}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label}
        </text>
      </svg>
    </div>
  );
}

/** AM/PM send-hours clocks with the peak-hour caption. */
export function ClockPairVisual({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? styles.clockPairLarge : undefined}>
      <div className={styles.clockPair}>
        <ClockFace label="AM" hours={HOURLY.slice(0, 12)} />
        <ClockFace label="PM" hours={HOURLY.slice(12, 24)} />
      </div>
      <p className={styles.clockCaption}>
        Peak <strong>10 AM</strong> · quietest 7 PM · 12 / 24 active hours
      </p>
    </div>
  );
}

/* -----------------------------------------------------------------
   Brand insight — discount timeline (sale history)
   ----------------------------------------------------------------- */

const DC_W = 300;
const DC_H = 120;
const DC_PAD = { top: 8, bottom: 26, left: 26, right: 8 };
const DC_INNER_W = DC_W - DC_PAD.left - DC_PAD.right;
const DC_INNER_H = DC_H - DC_PAD.top - DC_PAD.bottom;
const DC_BASE_Y = DC_PAD.top + DC_INNER_H;
const DC_CEIL = 50;

const DC_POINTS = [
  { p: 0.02, depth: 12 },
  { p: 0.13, depth: 18 },
  { p: 0.24, depth: 15 },
  { p: 0.36, depth: 22 },
  { p: 0.47, depth: 30 },
  { p: 0.58, depth: 45 },
  { p: 0.67, depth: 45 },
  { p: 0.79, depth: 33 },
  { p: 0.92, depth: 20 }
];

function dcX(p: number) {
  return snap(DC_PAD.left + p * DC_INNER_W);
}
function dcY(depth: number) {
  return snap(DC_BASE_Y - (Math.min(depth, DC_CEIL) / DC_CEIL) * DC_INNER_H);
}

/** Sale-history scatter: dots at (date, depth), stated window + extension. */
export function DiscountTimelineVisual() {
  const ticks = [0, 10, 20, 30, 40, 50];
  const peakIdx = 5;
  const winStart = 0.58;
  const winDeadline = 0.72;
  const winExtend = 0.8;
  const winY = dcY(45);

  return (
    <div className={styles.discountWrap}>
      <svg
        className={styles.discountChart}
        viewBox={`0 0 ${DC_W} ${DC_H}`}
        role="img"
        aria-label="Discount depth and stated offer windows over time"
      >
        {ticks.map((v) => {
          const gy = dcY(v);
          return (
            <g key={v}>
              <line
                x1={DC_PAD.left}
                x2={DC_W - DC_PAD.right}
                y1={gy}
                y2={gy}
                className={v === 0 ? styles.dcBaseline : styles.dcGrid}
              />
              <text
                x={DC_PAD.left - 5}
                y={gy}
                className={styles.dcYLabel}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {v}%
              </text>
            </g>
          );
        })}

        <rect
          x={dcX(winStart)}
          y={winY - 4}
          width={dcX(winDeadline) - dcX(winStart)}
          height={8}
          rx={4}
          className={styles.dcWindow}
        />
        <rect
          x={dcX(winDeadline)}
          y={winY - 4}
          width={dcX(winExtend) - dcX(winDeadline)}
          height={8}
          rx={4}
          className={styles.dcExt}
        />
        <text
          x={(dcX(winDeadline) + dcX(winExtend)) / 2}
          y={winY - 9}
          className={styles.dcExtLabel}
          textAnchor="middle"
        >
          +2d
        </text>
        <line
          x1={dcX(winDeadline)}
          x2={dcX(winDeadline)}
          y1={winY - 9}
          y2={winY + 9}
          className={styles.dcTick}
        />

        {DC_POINTS.map((pt, i) => {
          const x = dcX(pt.p);
          const y = dcY(pt.depth);
          const r = snap(3.4 + (Math.min(pt.depth, DC_CEIL) / DC_CEIL) * 1.2);
          return (
            <g key={i} style={{ ["--d" as string]: i }}>
              {i === peakIdx ? (
                <circle cx={x} cy={y} r={r + 3} className={styles.dcPeakRing} />
              ) : null}
              <circle cx={x} cy={y} r={r} className={styles.dcDot} />
            </g>
          );
        })}

        <text
          x={dcX(DC_POINTS[peakIdx].p)}
          y={dcY(45) - 8}
          className={styles.dcPeakLabel}
          textAnchor="middle"
        >
          45%
        </text>
      </svg>
      <div className={styles.dcLegend} aria-hidden="true">
        <span className={styles.dcLegendItem}>
          <span className={styles.dcLegendDot} /> Discount email
        </span>
        <span className={styles.dcLegendItem}>
          <span className={styles.dcLegendBar} /> Stated offer window
        </span>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
   Brand insight — full mini dashboard (feature-page poster)
   ----------------------------------------------------------------- */

/** Brand header + KPI grid + design DNA, the left panel of the dashboard. */
export function BrandPanelVisual() {
  return (
    <div className={styles.brandPanel}>
      <div className={styles.brandHeader}>
        <span className={styles.brandMono}>F</span>
        <div>
          <div className={styles.brandName}>Fenne</div>
          <div className={styles.brandDomain}>fenne.studio</div>
        </div>
      </div>

      <div className={styles.kpiGrid}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Captured</span>
          <span className={styles.kpiValue}>412</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Cadence</span>
          <span className={styles.kpiValue}>
            3.1 <small>days</small>
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Sale frequency</span>
          <span className={styles.kpiValue}>
            18% <small>· 27% avg</small>
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Platform</span>
          <span className={styles.kpiValue}>
            <small>Apsis One</small>
          </span>
        </div>
      </div>

      <div className={styles.designBlock}>
        <span className={styles.blockLabel}>Design DNA</span>
        <div className={styles.paletteRow}>
          {BRAND_PALETTE.map((hex) => (
            <span
              key={hex}
              className={styles.paletteSwatch}
              style={{ background: hex }}
            />
          ))}
        </div>
        <div className={styles.fontRow}>
          <span className={styles.fontSample} style={{ fontFamily: "Arial" }}>
            Aa
          </span>
          <span
            className={styles.fontSample}
            style={{ fontFamily: "Georgia, serif" }}
          >
            Aa
          </span>
          <span className={styles.fontSample} style={{ fontFamily: "Verdana" }}>
            Aa
          </span>
        </div>
      </div>
    </div>
  );
}

/** The composite mini brand dashboard (panel + clocks + sale history). */
export function BrandDashboardVisual() {
  return (
    <div className={`${styles.brandGrid} ${styles.brandTile}`}>
      <BrandPanelVisual />
      <div className={styles.brandCharts}>
        <div>
          <span className={styles.blockLabel}>Send hours</span>
          <div className={styles.clockPair} style={{ marginTop: "0.5rem" }}>
            <ClockFace label="AM" hours={HOURLY.slice(0, 12)} />
            <ClockFace label="PM" hours={HOURLY.slice(12, 24)} />
          </div>
          <p className={styles.clockCaption}>
            Peak <strong>10 AM</strong> · quietest 7 PM · 12 / 24 active hours
          </p>
        </div>
        <div>
          <span className={styles.blockLabel}>Sale history</span>
          <DiscountTimelineVisual />
        </div>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
   Collections — a saved auto-collection, exactly as the app shows it:
   the "Auto-rules" summary bar (CollectionDetailClient) above the
   matched email cards. REAL data: these three emails are genuinely
   category=welcome in captured_emails, so the rule truthfully matches.
   ----------------------------------------------------------------- */

const WELCOME_MATCHES = [
  {
    src: "/hero-emails/38b7a822-fc6b-4a7b-9a21-108217a82258.webp",
    brand: "SKIMS",
    subject: "Welcome to SKIMS!",
    date: "Jun 6 · 7:52 PM"
  },
  {
    src: "/hero-emails/9052ba84-215e-4bd7-9f90-a7ecb6fae7dc.webp",
    brand: "Rapha",
    subject: "Welcome to Rapha",
    date: "Jun 6 · 8:28 PM"
  },
  {
    src: "/hero-emails/ed04d69f-8505-4ca1-bf1f-a5e9668bfd4e.webp",
    brand: "Ralph Lauren",
    subject: "Your Ralph Lauren Story Starts Here",
    date: "Jun 6 · 8:09 PM"
  }
];

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    </svg>
  );
}

/** A saved auto-collection: name, the app's Auto-rules bar, matches. */
export function CollectionRulesVisual() {
  return (
    <div className={styles.colCard}>
      <div className={styles.colHead}>
        <span className={styles.colName}>Welcome series</span>
        <span className={styles.colMeta}>3 emails</span>
      </div>

      <div className={styles.rulesBar}>
        <span className={styles.rulesBarLabel}>
          <SparkleIcon /> Auto-rules
        </span>
        <span className={`${styles.rulesChip} ${styles.rulesChipScope}`}>
          <span className={styles.rulesChipLabel}>Scope</span>
          Only new emails
        </span>
        <span className={styles.rulesJoiner}>AND</span>
        <span className={styles.rulesChip}>
          <span className={styles.rulesChipLabel}>Content type</span>
          Welcome
        </span>
      </div>

      <div className={styles.colShelf}>
        {WELCOME_MATCHES.map((t, i) => (
          <article
            key={t.src}
            className={styles.emailCard}
            style={{ ["--i" as string]: i }}
          >
            <div className={styles.emailPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.src}
                alt={`${t.brand} — ${t.subject}`}
                loading="lazy"
              />
            </div>
            <div className={styles.emailMeta}>
              <span className={styles.emailBrand}>{t.brand}</span>
              <span className={styles.emailSubject}>{t.subject}</span>
              <span className={styles.emailDate}>{t.date}</span>
            </div>
          </article>
        ))}
      </div>

      <span className={styles.dropPlus}>Collected automatically, nobody saved these by hand</span>
    </div>
  );
}

/* -----------------------------------------------------------------
   Event detection — 3daysofdesign swimlane
   ----------------------------------------------------------------- */

const SWIM_LANES = [
  { name: "Fenne", dots: [0.08, 0.26, 0.5, 0.63, 0.79] },
  { name: "Askvik", dots: [0.3, 0.47, 0.66, 0.82] },
  { name: "Kalvig", dots: [0.42, 0.6, 0.74, 0.9] },
  { name: "Brendholt", dots: [0.55, 0.7, 0.86] }
];
const SW_W = 300;
const SW_GUTTER = 78;
const SW_RIGHT = 12;
const SW_TOP = 22;
const SW_LANE_H = 26;
const SW_PLOT_W = SW_W - SW_GUTTER - SW_RIGHT;

function swX(f: number) {
  return snap(SW_GUTTER + f * SW_PLOT_W);
}

/** "Who moves first" swimlane inside the detected festival window. */
export function EventSwimlaneVisual({ badge = true }: { badge?: boolean }) {
  const height = SW_TOP + SWIM_LANES.length * SW_LANE_H + 6;
  const bandX1 = swX(0.6);
  const bandX2 = swX(0.92);
  const ordered = SWIM_LANES.flatMap((lane, li) =>
    lane.dots.map((f) => ({ f, li }))
  ).sort((a, b) => a.f - b.f);
  const orderIndex = new Map(ordered.map((d, i) => [`${d.li}:${d.f}`, i]));

  return (
    <>
      {badge ? (
        <span className={styles.eventBadge}>Event detected · 3daysofdesign</span>
      ) : null}
      <svg
        className={styles.swimSvg}
        viewBox={`0 0 ${SW_W} ${height}`}
        role="img"
        aria-label="Which brands started emailing first around 3daysofdesign"
      >
        <rect
          x={bandX1}
          y={SW_TOP - 12}
          width={bandX2 - bandX1}
          height={SWIM_LANES.length * SW_LANE_H + 4}
          className={styles.eventBand}
        />
        <line
          x1={bandX1}
          x2={bandX1}
          y1={SW_TOP - 12}
          y2={SW_TOP - 12 + SWIM_LANES.length * SW_LANE_H + 4}
          className={styles.eventBandEdge}
        />
        <line
          x1={bandX2}
          x2={bandX2}
          y1={SW_TOP - 12}
          y2={SW_TOP - 12 + SWIM_LANES.length * SW_LANE_H + 4}
          className={styles.eventBandEdge}
        />
        {SWIM_LANES.map((lane, li) => {
          const cy = SW_TOP + li * SW_LANE_H;
          return (
            <g key={lane.name}>
              <text
                x={0}
                y={cy}
                className={styles.laneLabel}
                dominantBaseline="middle"
              >
                {lane.name}
              </text>
              <line
                x1={SW_GUTTER}
                x2={SW_W - SW_RIGHT}
                y1={cy}
                y2={cy}
                className={styles.laneTrack}
              />
              {lane.dots.map((f) => (
                <circle
                  key={f}
                  cx={swX(f)}
                  cy={cy}
                  r={4.5}
                  className={styles.laneDot}
                  style={{
                    ["--d" as string]: orderIndex.get(`${li}:${f}`) ?? 0
                  }}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </>
  );
}

/* -----------------------------------------------------------------
   Comparisons — cohort send-time heatmap
   ----------------------------------------------------------------- */

const CMP_BRANDS = [
  {
    name: "Fenne",
    color: "#4f46e5",
    hours: [0, 0, 0, 0, 0, 0, 1, 4, 9, 14, 11, 5, 2, 1, 2, 3, 1, 0, 0, 1, 0, 0, 0, 0]
  },
  {
    name: "Askvik",
    color: "#0ea5e9",
    hours: [0, 0, 0, 0, 0, 0, 0, 1, 3, 6, 8, 9, 12, 10, 5, 3, 2, 1, 1, 0, 0, 0, 0, 0]
  },
  {
    name: "Kalvig",
    color: "#10b981",
    hours: [0, 0, 0, 0, 0, 0, 2, 6, 11, 8, 4, 3, 2, 4, 7, 9, 6, 3, 1, 0, 0, 0, 0, 0]
  }
];

/** Per-brand 24-hour send heatmap with the "All brands" aggregate row. */
export function CompareHeatmapVisual() {
  const aggregate = Array.from({ length: 24 }, (_, h) =>
    CMP_BRANDS.reduce((sum, b) => sum + b.hours[h], 0)
  );
  const rows = [
    ...CMP_BRANDS,
    { name: "All brands", color: "#0f172a", hours: aggregate, aggregate: true }
  ];
  let cellCounter = 0;

  return (
    <>
      <div className={styles.cmpRows}>
        {rows.map((row) => {
          const max = Math.max(1, ...row.hours);
          const isAgg = "aggregate" in row && row.aggregate;
          return (
            <div
              key={row.name}
              className={`${styles.cmpRow} ${
                isAgg ? styles.cmpRowAggregate : ""
              }`}
            >
              <span className={styles.cmpLabel}>{row.name}</span>
              <div className={styles.cmpStrip}>
                {row.hours.map((count, h) => {
                  const ratio = count / max;
                  const opacity = ratio === 0 ? 0.08 : 0.22 + ratio * 0.78;
                  const d = cellCounter++;
                  return (
                    <span
                      key={h}
                      className={styles.cmpCell}
                      style={{
                        background: row.color,
                        opacity,
                        ["--d" as string]: d
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.cmpAxis} aria-hidden="true">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>
    </>
  );
}

/* -----------------------------------------------------------------
   Following — the clean feed of followed brands
   ----------------------------------------------------------------- */

const FOLLOWED = [
  {
    mono: "F",
    name: "Fenne",
    sub: "Furniture · Denmark",
    flag: "🇩🇰",
    meta: "3 new this week"
  },
  {
    mono: "A",
    name: "Askvik",
    sub: "Lighting · Norway",
    flag: "🇳🇴",
    meta: "2 new this week"
  },
  {
    mono: "K",
    name: "Kalvig",
    sub: "Interiors · Denmark",
    flag: "🇩🇰",
    meta: "1 new this week"
  }
];

/** Followed-brand cards with activity dots. */
export function FollowFeedVisual() {
  return (
    <div className={styles.followList}>
      {FOLLOWED.map((b, i) => (
        <div
          key={b.name}
          className={styles.followCard}
          style={{ ["--d" as string]: i }}
        >
          <span className={styles.followAvatar}>{b.mono}</span>
          <div className={styles.followBody}>
            <div className={styles.followName}>
              {b.name} <span aria-hidden="true">{b.flag}</span>
            </div>
            <div className={styles.followSub}>{b.sub}</div>
          </div>
          <span className={styles.followMeta}>
            <span className={styles.followDot} />
            {b.meta}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------------
   Explore — filter row + email-card masonry
   ----------------------------------------------------------------- */

type Thumb = {
  src: string;
  brand: string;
  subject: string;
  date: string;
};

// REAL captured data — brand names, subjects, and send times pulled from
// captured_emails (times shown in Europe/Copenhagen, like the app). If a
// thumbnail is swapped, re-query the DB; never guess these fields.
const THUMBS: Thumb[] = [
  {
    src: "/hero-emails/7002d123-edc8-4669-a4db-990a3ba56e08.webp",
    brand: "Hay",
    subject: "Take dining outside",
    date: "May 15 · 1:01 PM"
  },
  {
    src: "/hero-emails/f15538ab-51fa-4147-85ee-952aa8cfd16b.webp",
    brand: "Audo",
    subject: "Portable Lamps for Evolving Spaces",
    date: "May 12 · 9:30 AM"
  },
  {
    src: "/hero-emails/1acdc205-6046-4a99-adac-f40d50d9b058.webp",
    brand: "Stine Goya",
    subject: "Your 10% offer ends soon",
    date: "Jun 7 · 8:59 PM"
  },
  {
    src: "/hero-emails/25339baf-3c61-4f17-9eaf-e61b3f63ad46.webp",
    brand: "ARKET",
    subject: "Linen, shaped anew",
    date: "Jun 7 · 6:11 PM"
  },
  {
    src: "/hero-emails/4406e954-16cd-4f01-86ef-305f2e98f105.webp",
    brand: "Muuto",
    subject: "Searching for the perfect sofa?",
    date: "Jun 6 · 12:01 PM"
  },
  {
    src: "/hero-emails/5b6b0692-a38b-4184-9281-4fcc664739b6.webp",
    brand: "Coffee Collective",
    subject: "Get early access to La Palma",
    date: "Jun 3 · 5:15 AM"
  },
  {
    src: "/hero-emails/9052ba84-215e-4bd7-9f90-a7ecb6fae7dc.webp",
    brand: "Rapha",
    subject: "Welcome to Rapha",
    date: "Jun 6 · 8:28 PM"
  },
  {
    src: "/hero-emails/d82efd81-e723-4cb0-9789-0d772928e3ad.webp",
    brand: "GANNI",
    subject: "Your Ultimate Summer Bou Bag",
    date: "Jun 8 · 10:17 AM"
  },
  {
    src: "/hero-emails/ed04d69f-8505-4ca1-bf1f-a5e9668bfd4e.webp",
    brand: "Ralph Lauren",
    subject: "Your Ralph Lauren Story Starts Here",
    date: "Jun 6 · 8:09 PM"
  }
];

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M20 20l-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The explore filter row + masonry of real captured newsletters. */
export function LibraryShowcase() {
  return (
    <div>
      <div className={styles.filterRow} aria-hidden="true">
        <span className={styles.searchField}>
          <SearchIcon />
          Search 3,500+ emails
        </span>
        <span className={`${styles.filterChip} ${styles.filterChipActive}`}>
          Brands
          <span className={styles.filterCount}>4</span>
        </span>
        <span className={styles.filterChip}>Content type</span>
        <span className={styles.filterChip}>
          Colours
          <span className={styles.swatchDots}>
            <span
              className={styles.swatchDot}
              style={{ background: "#5E6E4A" }}
            />
            <span
              className={styles.swatchDot}
              style={{ background: "#B86F4C" }}
            />
            <span
              className={styles.swatchDot}
              style={{ background: "#1A1A1A" }}
            />
          </span>
        </span>
        <span className={styles.filterChip}>Has GIF</span>
      </div>

      <div className={styles.libGrid}>
        {THUMBS.map((t, i) => (
          <article
            key={t.src}
            className={styles.emailCard}
            style={{ ["--i" as string]: i }}
          >
            <div className={styles.emailPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.src}
                alt={`${t.brand} — ${t.subject}`}
                loading="lazy"
              />
            </div>
            <div className={styles.emailMeta}>
              <span className={styles.emailBrand}>{t.brand}</span>
              <span className={styles.emailSubject}>{t.subject}</span>
              <span className={styles.emailDate}>{t.date}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
