import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import landing from "@/components/marketing/landing.module.css";
import { pageMetadata } from "@/lib/page-metadata";
import { SITE_URL } from "@/lib/site";
import { countryFlag, countryName } from "@/lib/country";
import {
  BLACK_FRIDAY,
  CYBER_MONDAY,
  METHOD_KEYWORDS,
  SINGLES_DAY,
  WINDOW_END,
  WINDOW_START,
  daysBetween,
  loadBlackFriday,
  pct,
  phaseLabel,
  shortDate,
  type BfBrand,
  type BlackFridayData
} from "@/lib/black-friday";
import s from "./black-friday.module.css";

/** A category or market median is shown once this many brands are behind it. */
const MIN_SPLIT_BRANDS = 8;
/** Per-brand volume and design comparisons wait for this many Black Friday emails. */
const MIN_EMAILS_FOR_COMPARISONS = 300;

// The snapshot behind this page refreshes hourly in the database.
export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "Black Friday Email Tracker 2026 — Pirol",
  description:
    "Live data on Black Friday 2026 emails from 500 brands: when campaigns start, how deep the discounts go, deadlines, subject lines and real examples. Updated every hour.",
  path: "/black-friday",
  socialTitle: "Black Friday Email Tracker 2026",
  socialDescription:
    "How 500 brands run Black Friday email in 2026: timing, discounts, deadlines, subject lines and examples. Updated every hour."
});

export default async function BlackFridayPage() {
  const data = await loadBlackFriday();

  return (
    <main className={landing.page}>
      <SiteHeader />
      <div className={s.wrap}>
        {data ? <Tracker data={data} /> : <Empty />}
      </div>
      <SiteFooter />
    </main>
  );
}

function Empty() {
  return (
    <header className={s.hero}>
      <p className={s.eyebrow}>Black Friday 2026</p>
      <h1 className={s.title}>Black Friday Email Tracker</h1>
      <p className={s.lede}>The first numbers are being counted. Check back within the hour.</p>
    </header>
  );
}

function Tracker({ data }: { data: BlackFridayData }) {
  const { snapshot: d, brands } = data;
  const h = d.headline;
  const day = d.generated_at.slice(0, 10);
  const brand = (id: string) => brands[id];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: "Black Friday Email Tracker 2026",
            description:
              "Daily counts of Black Friday and Cyber Monday marketing emails, discount depth, deadlines and subject line patterns across brands tracked by Pirol.",
            url: `${SITE_URL}/black-friday`,
            temporalCoverage: `${WINDOW_START}/${WINDOW_END}`,
            dateModified: d.generated_at,
            creator: { "@type": "Organization", name: "Pirol", url: SITE_URL }
          })
        }}
      />

      <header className={s.hero}>
        <p className={s.eyebrow}>
          <span className={s.live} aria-hidden /> {phaseLabel(day)}
        </p>
        <h1 className={s.title}>Black Friday Email Tracker 2026</h1>
        <p className={s.lede}>
          Every Black Friday email from {h.brands_tracked} brands we follow, counted as it lands.
          When campaigns start, how deep the discounts go, and which deadlines quietly move.
        </p>
        <p className={s.meta}>
          Updated {shortDate(day)} at{" "}
          {new Date(d.generated_at).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Copenhagen"
          })}{" "}
          CET. Refreshed every hour.
        </p>
      </header>

      <section className={s.kpis} aria-label="Headline numbers">
        <Kpi value={`${h.brands_live}`} label="brands running Black Friday" sub={`of ${h.brands_tracked} tracked`} />
        <Kpi value={h.bf_emails.toLocaleString("en-US")} label="Black Friday emails so far" sub={`since ${shortDate(WINDOW_START)}`} />
        <Kpi
          value={h.median_discount == null ? "n/a" : `${Math.round(h.median_discount)}%`}
          label="median discount"
          sub="largest offer per email"
        />
        {h.brands_extended > 0 ? (
          <Kpi value={`${h.brands_extended}`} label="brands extended a sale" sub="after stating an end date" />
        ) : (
          <Kpi value={pct(h.deadline_share)} label="state when the offer ends" sub="of Black Friday emails" />
        )}
      </section>

      <RunUp data={data} />

      <Section
        id="timing"
        title="When Black Friday emails start"
        lede="How many weeks before Black Friday each brand sent its first Black Friday email."
      >
        <div className={s.split}>
          <LeadChart buckets={d.lead.buckets ?? []} />
          <BrandList
            heading="First to start"
            rows={(d.lead.earliest ?? []).map((r) => ({
              brand: brand(r.brand),
              value: `${r.days_before} days before`,
              date: shortDate(r.first_day)
            }))}
          />
        </div>
      </Section>

      <Section
        id="stages"
        title="From teaser to last chance"
        lede="What each Black Friday email is doing, read from its subject line and preview text, week by week."
      >
        <Stages rows={d.stages ?? []} />
      </Section>

      <Section
        id="discounts"
        title="How deep Black Friday discounts go"
        lede={`The largest percentage offered in each Black Friday email.${
          d.discounts.no_discount ? ` ${d.discounts.no_discount} of ${h.bf_emails} name no discount at all.` : ""
        }`}
      >
        <div className={s.split}>
          <DiscountChart buckets={d.discounts.buckets ?? []} />
          <div className={s.stack}>
            <MedianRows
              heading="Median by category"
              rows={d.discounts.by_category ?? []}
              format={(l) => l.charAt(0).toUpperCase() + l.slice(1)}
            />
            <MedianRows
              heading="Median by market"
              rows={d.discounts.by_country ?? []}
              format={(l) => `${countryFlag(l)} ${countryName(l)}`}
            />
          </div>
        </div>
        <BrandList
          heading="Deepest discounts"
          wide
          rows={(d.discounts.deepest ?? []).map((r) => ({
            brand: brand(r.brand),
            value: `${Math.round(r.pct)}%`,
            note: r.subject ?? "",
            date: shortDate(r.d)
          }))}
        />
        <p className={s.footnote}>Only discounts the subject line or preview text states are listed here.</p>
      </Section>

      <Section
        id="deadlines"
        title="Deadlines, and deadlines that move"
        lede={`${pct(h.deadline_share)} of Black Friday emails state when the offer ends. We track every stated end date, so an extended sale shows up as a bar that grows.`}
      >
        <Windows data={data} today={d.through} />
      </Section>

      <Section
        id="volume"
        title="Who goes all in on Black Friday"
        lede="The share of each brand's emails that are about Black Friday, counted from its first Black Friday email."
      >
        {h.bf_emails < MIN_EMAILS_FOR_COMPARISONS ? (
          <Pending have={h.bf_emails} />
        ) : (
          <>
            <BrandList
              heading="Most Black Friday focused"
              wide
              bars
              rows={d.loudest.map((r) => ({
                brand: brand(r.brand),
                value: pct(r.n / r.total),
                amount: r.n / r.total,
                note: `${r.n} of ${r.total} emails`
              }))}
            />
            {d.peak && (
              <p className={s.footnote}>
                Busiest day so far: {shortDate(d.peak.d)}, with {d.peak.n} Black Friday emails.
                {h.cyber_share ? ` ${pct(h.cyber_share)} of all Black Friday emails mention Cyber Monday or Cyber Week.` : ""}
              </p>
            )}
          </>
        )}
      </Section>

      <Section
        id="subject-lines"
        title="Black Friday email subject lines"
        lede="What brands write in the subject line, and the most recent examples."
      >
        <div className={s.tiles}>
          <Tile value={d.subjects.avg_length == null ? "n/a" : `${d.subjects.avg_length}`} label="characters on average" />
          <Tile value={pct(d.subjects.emoji_share)} label="use an emoji" />
          <Tile value={pct(d.subjects.caps_share)} label="shout a word in CAPS" />
          <Tile value={pct(d.subjects.early_access_share)} label="promise early or VIP access" />
          <Tile value={pct(d.subjects.free_shipping_share)} label="mention free shipping" />
          <Tile value={pct(d.subjects.promo_code_share)} label="include a promo code" />
        </div>
        <BrandList
          heading="Latest subject lines"
          wide
          rows={(d.subjects.examples ?? []).slice(0, 12).map((r) => ({
            brand: brand(r.brand),
            value: "",
            note: r.subject,
            date: shortDate(r.d)
          }))}
        />
      </Section>

      <Section
        id="design"
        title="How Black Friday emails differ"
        lede="Black Friday emails compared with all emails sent in October."
      >
        {h.bf_emails < MIN_EMAILS_FOR_COMPARISONS ? (
          <Pending have={h.bf_emails} />
        ) : (
          <div className={s.pairs}>
            <Pair label="Use animated GIFs" bf={d.design.gif_bf} base={d.design.gif_base} />
            <Pair label="State when the offer ends" bf={d.design.deadline_bf} base={d.design.deadline_base} />
          </div>
        )}
      </Section>

      {d.optouts.length >= 5 && (
        <Section
          id="opt-outs"
          title="Brands sitting Black Friday out"
          lede="Green Friday, Giving Tuesday and other ways of saying no to the discount rush."
        >
          <BrandList
            heading="Opting out"
            wide
            rows={d.optouts.map((r) => ({
              brand: brand(r.brand),
              value: "",
              note: r.subject ?? "",
              date: shortDate(r.d)
            }))}
          />
        </Section>
      )}

      <Section
        id="examples"
        title="Black Friday email examples"
        lede="The latest Black Friday email from each brand. Open a brand to see everything it sends."
      >
        <ul className={s.gallery}>
          {d.gallery.map((g) => {
            const b = brand(g.brand);
            const src = data.previews[g.id];
            if (!b) return null;
            return (
              <li key={g.id}>
                <Link href={`/brands/${b.slug}`} className={s.card}>
                  <span className={s.cardImg}>
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={`${b.name} Black Friday email: ${g.subject ?? ""}`} loading="lazy" decoding="async" />
                    ) : (
                      <span className={s.cardText}>{g.subject}</span>
                    )}
                    {g.pct ? <span className={s.badge}>{Math.round(g.pct)}%</span> : null}
                  </span>
                  <span className={s.cardBrand}>
                    <Logo b={b} /> {b.name}
                  </span>
                  <span className={s.cardSubject}>{g.subject}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      <section className={s.cta}>
        <h2>Follow these brands for free</h2>
        <p>Get every email they send in one place, with their deadlines, discounts and send times.</p>
        <div className={s.ctaRow}>
          <Link href="/signup" className={landing.primaryBtn}>
            Create a free account
          </Link>
          <Link href="/brands" className={s.secondary}>
            Browse all brands
          </Link>
        </div>
      </section>

      <Section id="method" title="How we count">
        <div className={s.method}>
          <p>
            Pirol subscribes to brand newsletters with its own inboxes and reads every email that arrives.
            An email counts as a Black Friday email when its subject line or preview text mentions one of:{" "}
            {METHOD_KEYWORDS.join(", ")}. Welcome emails and messages opting out of Black Friday are left out.
          </p>
          <p>
            The discount is the largest percentage the email offers, so an email saying up to 50% counts as 50%.
            Deadlines are only counted when the email states one. October ({shortDate(WINDOW_START)} to Oct 31)
            is the baseline for normal sending. Brands are grouped by their main market.
          </p>
          <p>
            Each brand is followed with one inbox, so personalised or segmented sends may differ. 2026 is the
            first year we track, so there is no comparison with last year yet. The tracker runs until{" "}
            {shortDate(WINDOW_END)}.
          </p>
        </div>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  id,
  title,
  lede,
  children
}: {
  id: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={s.section} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={s.h2}>
        {title}
      </h2>
      {lede && <p className={s.sectionLede}>{lede}</p>}
      {children}
    </section>
  );
}

function Kpi({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className={s.kpi}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{sub}</small>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className={s.tile}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Logo({ b }: { b: BfBrand }) {
  return b.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={s.logo} src={b.logoUrl} alt="" width={20} height={20} loading="lazy" decoding="async" />
  ) : (
    <span className={s.logo} aria-hidden>
      {b.name.slice(0, 1)}
    </span>
  );
}

const bar = (share: number): CSSProperties => ({ "--v": `${Math.max(0, Math.min(1, share)) * 100}%` }) as CSSProperties;

/** Daily Black Friday emails across the whole season, with event markers. */
function RunUp({ data }: { data: BlackFridayData }) {
  const { daily, through } = data.snapshot;
  const total = daysBetween(WINDOW_START, WINDOW_END) + 1;
  const byDay = new Map(daily.map((x) => [x.d, x]));
  const share = (x?: { bf: number; all: number }) => (x && x.all > 0 ? x.bf / x.all : 0);
  // Round the scale up to a whole 5% so the top label reads cleanly.
  const max = Math.max(0.05, Math.ceil(Math.max(...daily.map(share)) * 20) / 20);
  const days = Array.from({ length: total }, (_, i) => {
    const date = new Date(Date.parse(`${WINDOW_START}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    return { date, day: byDay.get(date), future: date > through };
  });
  const at = (date: string) => ({ left: `${((daysBetween(WINDOW_START, date) + 0.5) / total) * 100}%` });

  return (
    <Section
      id="run-up"
      title="The run-up, day by day"
      lede="The share of all emails each day that mention Black Friday, since October 1. Days still to come are empty."
    >
      <div className={s.runup}>
        <span className={s.yMax}>{pct(max)}</span>
        <div className={s.plot}>
          <div className={s.runupBars}>
            {days.map((x) => (
              <span
                key={x.date}
                className={x.future ? s.future : undefined}
                style={bar(share(x.day) / max)}
                title={
                  x.future
                    ? shortDate(x.date)
                    : `${shortDate(x.date)}: ${x.day?.bf ?? 0} of ${x.day?.all ?? 0} emails (${pct(share(x.day))})`
                }
              />
            ))}
          </div>
          {[
            [SINGLES_DAY, "Singles Day"],
            [BLACK_FRIDAY, "Black Friday"],
            [CYBER_MONDAY, "Cyber Monday"]
          ].map(([date, label], i) => (
            <span key={date} className={date > SINGLES_DAY ? `${s.marker} ${s.markerEnd}` : s.marker} style={at(date)}>
              <span style={{ top: `${i * 1.05}rem` }}>{label}</span>
            </span>
          ))}
          <div className={s.axis}>
            <span style={at("2026-10-01")}>Oct 1</span>
            <span style={at("2026-11-01")}>Nov 1</span>
            <span style={at("2026-12-01")}>Dec 1</span>
          </div>
        </div>
      </div>
    </Section>
  );
}

const LEAD_LABELS: Record<number, string> = {
  0: "On the day or after",
  1: "Under 1 week",
  8: "8 weeks or more"
};

function LeadChart({ buckets }: { buckets: { w: number; n: number }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.n));
  const rows = [8, 7, 6, 5, 4, 3, 2, 1, 0].map((w) => ({ w, n: buckets.find((b) => b.w === w)?.n ?? 0 }));
  return (
    <div className={s.hbars}>
      <h3 className={s.h3}>Brands by first Black Friday email</h3>
      {rows.map((r) => (
        <div key={r.w} className={s.hrow}>
          <span className={s.hlabel}>{LEAD_LABELS[r.w] ?? `${r.w} weeks before`}</span>
          <span className={s.htrack}>
            <span style={bar(r.n / max)} />
          </span>
          <span className={s.hvalue}>{r.n}</span>
        </div>
      ))}
    </div>
  );
}

const DISCOUNT_LABELS = ["Under 20%", "20 to 29%", "30 to 39%", "40 to 49%", "50% or more"];

function DiscountChart({ buckets }: { buckets: { k: number; n: number }[] }) {
  const counts = DISCOUNT_LABELS.map((_, k) => buckets.find((b) => b.k === k)?.n ?? 0);
  const max = Math.max(1, ...counts);
  const sum = counts.reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <h3 className={s.h3}>Emails by discount</h3>
      <div className={s.columns}>
        {counts.map((n, k) => (
          <div key={k} className={s.column}>
            <span className={s.colValue}>{Math.round((n / sum) * 100)}%</span>
            <span className={s.colTrack}>
              <span style={bar(n / max)} />
            </span>
            <span className={s.colLabel}>{DISCOUNT_LABELS[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MedianRows({
  heading,
  rows,
  format
}: {
  heading: string;
  rows: { label: string; median: number; brands: number }[];
  format: (label: string) => string;
}) {
  const shown = rows.filter((r) => r.brands >= MIN_SPLIT_BRANDS);
  if (shown.length === 0) {
    return (
      <div>
        <h3 className={s.h3}>{heading}</h3>
        <p className={s.pending}>Shown once {MIN_SPLIT_BRANDS} brands in a group have sent a discount.</p>
      </div>
    );
  }
  return (
    <div className={s.hbars}>
      <h3 className={s.h3}>{heading}</h3>
      {shown.map((r) => (
        <div key={r.label} className={s.hrow}>
          <span className={s.hlabel}>
            {format(r.label)} <small>{r.brands} brands</small>
          </span>
          <span className={s.htrack}>
            <span style={bar(r.median / 80)} />
          </span>
          <span className={s.hvalue}>{Math.round(r.median)}%</span>
        </div>
      ))}
    </div>
  );
}

type ListRow = { brand?: BfBrand; value: string; note?: string; date?: string; amount?: number };

function BrandList({
  heading,
  rows,
  wide,
  bars
}: {
  heading: string;
  rows: ListRow[];
  wide?: boolean;
  bars?: boolean;
}) {
  const shown = rows.filter((r): r is ListRow & { brand: BfBrand } => Boolean(r.brand));
  if (shown.length === 0) return null;
  const max = Math.max(1, ...shown.map((r) => r.amount ?? 0));
  return (
    <div className={wide ? s.listWide : undefined}>
      <h3 className={s.h3}>{heading}</h3>
      <ol className={s.list}>
        {shown.map((r, i) => (
          <li key={`${r.brand.slug}-${i}`}>
            <Link href={`/brands/${r.brand.slug}`} className={s.listBrand}>
              <Logo b={r.brand} /> {r.brand.name}
            </Link>
            <span className={s.listNote}>
              {bars && r.amount != null ? (
                <span className={s.inlineBar} style={bar(r.amount / max)} />
              ) : null}
              {r.note}
            </span>
            {r.date && <span className={s.listDate}>{r.date}</span>}
            {r.value && <strong className={s.listValue}>{r.value}</strong>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Offer windows as horizontal bars; extensions show the part past the first stated end. */
function Windows({ data, today }: { data: BlackFridayData; today: string }) {
  const rows = data.snapshot.windows.filter((w) => data.brands[w.brand]);
  if (rows.length === 0) {
    return <p className={s.footnote}>No Black Friday email has stated an end date yet.</p>;
  }
  const start = rows.reduce((m, w) => (w.start < m ? w.start : m), rows[0].start);
  const end = rows.reduce((m, w) => (w.end > m ? w.end : m), CYBER_MONDAY);
  const span = daysBetween(start, end) + 1;
  const x = (date: string) => (daysBetween(start, date) / span) * 100;
  const pos = (from: string, to: string): CSSProperties => ({
    left: `${x(from)}%`,
    width: `${Math.max(1, x(to) - x(from) + 100 / span)}%`
  });

  return (
    <div className={s.windows}>
      <div className={s.winAxis}>
        <span style={{ left: "0%" }}>{shortDate(start)}</span>
        <span style={{ left: `${x(BLACK_FRIDAY)}%` }}>Black Friday</span>
        {x(BLACK_FRIDAY) < 85 && <span style={{ left: "100%" }}>{shortDate(end)}</span>}
      </div>
      {rows.map((w) => {
        const b = data.brands[w.brand];
        const extended = w.extended && w.first_end < w.end;
        return (
          <div key={w.brand} className={s.winRow}>
            <Link href={`/brands/${b.slug}`} className={s.listBrand}>
              <Logo b={b} /> {b.name}
            </Link>
            <span
              className={s.winTrack}
              title={`${shortDate(w.start)} to ${shortDate(w.end)}${extended ? `, first said ${shortDate(w.first_end)}` : ""}`}
            >
              <span className={s.winBar} style={pos(w.start, extended ? w.first_end : w.end)} />
              {extended && <span className={s.winExt} style={pos(w.first_end, w.end)} />}
              <span className={s.winBf} style={{ left: `${x(BLACK_FRIDAY)}%` }} />
              <span className={s.winToday} style={{ left: `${Math.min(100, x(today))}%` }} />
            </span>
          </div>
        );
      })}
      <p className={s.legend}>
        <span className={s.keyBar} /> Stated offer period <span className={s.keyExt} /> Extended{" "}
        <span className={s.keyToday} /> Today
      </p>
    </div>
  );
}

function Pair({ label, bf, base }: { label: string; bf: number | null; base: number | null }) {
  return (
    <div className={s.pair}>
      <h3 className={s.h3}>{label}</h3>
      {[
        ["Black Friday emails", bf, s.pairBf],
        ["October emails", base, s.pairBase]
      ].map(([name, v, cls]) => (
        <div key={name as string} className={s.hrow}>
          <span className={s.hlabel}>{name as string}</span>
          <span className={s.htrack}>
            <span className={cls as string} style={bar((v as number | null) ?? 0)} />
          </span>
          <span className={s.hvalue}>{pct(v as number | null)}</span>
        </div>
      ))}
    </div>
  );
}

function Pending({ have }: { have: number }) {
  return (
    <p className={s.pending}>
      This fills in during Black Week, once there are {MIN_EMAILS_FOR_COMPARISONS} Black Friday emails to compare. So
      far: {have}.
    </p>
  );
}

const STAGES = [
  { id: "teaser", label: "Teaser" },
  { id: "early", label: "Early access" },
  { id: "live", label: "Sale is live" },
  { id: "last_chance", label: "Last chance" },
  { id: "extended", label: "Extended" },
  { id: "other", label: "Other mentions" }
] as const;

/** One 100% bar per week, split by campaign stage. Weeks with a handful of emails are skipped. */
function Stages({ rows }: { rows: { wk: string; stage: string; n: number }[] }) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.wk, (totals.get(r.wk) ?? 0) + r.n);
  const weeks = [...totals].filter(([, n]) => n >= 5).map(([wk]) => wk).sort();
  if (weeks.length === 0) return null;
  return (
    <div className={s.stages}>
      {weeks.map((wk) => {
        const counts = STAGES.map((st) => rows.find((r) => r.wk === wk && r.stage === st.id)?.n ?? 0);
        const sum = counts.reduce((a, b) => a + b, 0);
        return (
          <div key={wk} className={s.stageRow}>
            <span className={s.hlabel}>
              Week of {shortDate(wk)} <small>{sum}</small>
            </span>
            <span className={s.stageBar}>
              {STAGES.map((st, i) =>
                counts[i] ? (
                  <span
                    key={st.id}
                    className={s[`st_${st.id}`]}
                    style={{ flexGrow: counts[i] }}
                    title={`${st.label}: ${counts[i]} of ${sum}`}
                  />
                ) : null
              )}
            </span>
          </div>
        );
      })}
      <p className={s.legend}>
        {STAGES.map((st) => (
          <span key={st.id} className={s.legendItem}>
            <span className={`${s.swatch} ${s[`st_${st.id}`]}`} /> {st.label}
          </span>
        ))}
      </p>
    </div>
  );
}
