"use client";

import type { UserMetrics } from "@/lib/admin-types";
import UserGrowthChart from "./UserGrowthChart";

const INT = new Intl.NumberFormat("en-US");

function int(value: number): string {
  return INT.format(Math.round(value));
}

/** A fraction in [0,1] → whole-number percent, or an em dash when null. */
function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Signed percent for the growth-rate delta (e.g. "+120%"), em dash when null. */
function signedPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const p = Math.round(value * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

/** Lifecycle buckets for the retention bar — active → lapsed → never onboarded. */
const RECENCY: {
  key: "active7d" | "recent" | "atRisk" | "dormant" | "neverOnboarded";
  label: string;
  color: string;
}[] = [
  { key: "active7d", label: "Active · ≤7d", color: "#059669" },
  { key: "recent", label: "Recent · 8–30d", color: "#086e4b" },
  { key: "atRisk", label: "At risk · 31–60d", color: "#d97706" },
  { key: "dormant", label: "Dormant · 60d+", color: "#dc2626" },
  { key: "neverOnboarded", label: "Never onboarded", color: "#94a3b8" }
];

/** Outcome buckets for the onboarding-modal bar. */
const ONBOARDING_OUTCOMES: { key: "completed" | 1 | 2 | 3 | "pending"; label: string; color: string }[] = [
  { key: "completed", label: "Completed", color: "#086e4b" },
  { key: 1, label: "Skipped at step 1 · role", color: "#dc2626" },
  { key: 2, label: "Skipped at step 2 · categories", color: "#ea580c" },
  { key: 3, label: "Skipped at step 3 · brands", color: "#d97706" },
  { key: "pending", label: "Not answered yet", color: "#94a3b8" }
];

const SINCE_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

function sinceLabel(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "launch" : SINCE_DATE.format(parsed);
}

/** Rows of the onboarding "by outcome" table, in funnel order. */
const OUTCOME_ORDER: { key: "completed" | "skipped" | "pending"; label: string }[] = [
  { key: "completed", label: "Completed the modal" },
  { key: "skipped", label: "Skipped it" },
  { key: "pending", label: "Not answered yet" }
];

/** Buckets for the time-to-first-action bar. */
const FIRST_ACTION_BUCKETS: {
  key: "within1h" | "within24h" | "within7d" | "later" | "never";
  label: string;
  color: string;
}[] = [
  { key: "within1h", label: "Within an hour", color: "#059669" },
  { key: "within24h", label: "Same day", color: "#086e4b" },
  { key: "within7d", label: "Within a week", color: "#d97706" },
  { key: "later", label: "Later", color: "#ea580c" },
  { key: "never", label: "Never acted", color: "#94a3b8" }
];

/** "12m", "3.5h", "2.1d" — or an em dash when null. */
function duration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function when(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_TIME.format(parsed);
}

/** "3 of 12 (25%)" for a share of a row. */
function share(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${int(part)} (${Math.round((part / whole) * 100)}%)`;
}

/** Title-case a category slug ("home & living" → "Home & living"). */
function categoryLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

const ENGAGEMENT: { key: "dau" | "wau" | "mau"; label: string }[] = [
  { key: "dau", label: "Daily (DAU)" },
  { key: "wau", label: "Weekly (WAU)" },
  { key: "mau", label: "Monthly (MAU)" }
];

/**
 * The "Users" admin tab: four lenses on audience health — growth across tiers,
 * retention / churn, product-market-fit proxies, and the activation funnel.
 * All metrics come pre-aggregated from `/api/admin/user-metrics`.
 */
export default function UserMetricsPanels({
  metrics,
  loading
}: {
  metrics: UserMetrics | null;
  loading: boolean;
}) {
  if (!metrics) {
    return (
      <section className="card dashboard-panel">
        <p className="muted">{loading ? "Loading user metrics…" : "Couldn't load user metrics."}</p>
      </section>
    );
  }

  const {
    totals,
    growth,
    retention,
    subscription,
    pmf,
    funnel,
    onboarding,
    timeToFirstAction: tfa,
    upgradePrompts,
    signupSources
  } = metrics;
  const tfaTotal = Math.max(tfa.total, 1);
  const sourceMax = Math.max(...signupSources.map((s) => s.total), 1);
  const outcomeRows = OUTCOME_ORDER.map((o) => ({
    ...o,
    row: onboarding.byOutcome.find((r) => r.outcome === o.key) ?? null
  }));
  const recencyTotal = Math.max(retention.realTotal, 1);
  const engagementMax = Math.max(pmf.mau, 1);
  const funnelTop = Math.max(funnel[0]?.count ?? 0, 1);
  const onboardingTotal = Math.max(onboarding.total, 1);
  const onboardingCount = (key: (typeof ONBOARDING_OUTCOMES)[number]["key"]): number =>
    key === "completed"
      ? onboarding.completed
      : key === "pending"
        ? onboarding.pending
        : onboarding.skippedByStep[key - 1];
  const decided = onboarding.completed + onboarding.skipped;
  const roleMax = Math.max(...onboarding.roles.map((r) => r.count), 1);
  const categoryMax = Math.max(...onboarding.categories.map((c) => c.count), 1);
  const skipPeak = onboarding.skippedByStep.indexOf(Math.max(...onboarding.skippedByStep)) + 1;

  return (
    <>
      {/* Headline KPIs. */}
      <section className="stats-grid">
        <article className="card">
          <h2>Total users</h2>
          <p>
            {int(totals.total)}
            <span className="card-sub">
              {int(totals.free)} free · {int(totals.paid)} paid · {int(totals.admins)} team
            </span>
          </p>
        </article>
        <article className="card">
          <h2>New (30d)</h2>
          <p>
            {int(growth.new30d)}
            <span className="card-sub">{signedPct(growth.growthRate30d)} vs prior 30d</span>
          </p>
        </article>
        <article className="card">
          <h2>Active (30d)</h2>
          <p>
            {int(pmf.mau)}
            <span className="card-sub">{pct(pmf.stickiness)} DAU/MAU stickiness</span>
          </p>
        </article>
        <article className="card">
          <h2>Activation rate</h2>
          <p>
            {pct(pmf.activationRate)}
            <span className="card-sub">{int(pmf.activated)} took a core action</span>
          </p>
        </article>
      </section>

      {/* 1 — Growth across tiers. */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>User growth by tier</h2>
          <span className="muted">cumulative signups and paid conversions over time</span>
        </div>
        {loading && growth.series.length === 0 ? (
          <p className="muted">Loading growth…</p>
        ) : (
          <UserGrowthChart data={growth.series} />
        )}
        <div className="stats-grid">
          <article className="card card-inset">
            <h2>Free</h2>
            <p>{int(totals.free)}</p>
          </article>
          <article className="card card-inset">
            <h2>Paid</h2>
            <p>
              {int(totals.paid)}
              <span className="card-sub">
                {pct(totals.total > 0 ? totals.paid / totals.total : null)} of users
              </span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Team</h2>
            <p>{int(totals.admins)}</p>
          </article>
        </div>
      </section>

      {/* 2 — Retention & churn. */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Retention &amp; churn</h2>
          <span className="muted">
            non-team users by lifecycle stage · {int(retention.realTotal)} tracked
          </span>
        </div>

        <div className="stats-grid">
          <article className="card card-inset">
            <h2>30-day churn</h2>
            <p>
              {pct(retention.inactiveRate30d)}
              <span className="card-sub">
                of {int(retention.onboarded)} onboarded, not seen in 30d
              </span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Never onboarded</h2>
            <p>
              {int(retention.neverOnboarded)}
              <span className="card-sub">signed up, never loaded the app</span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Subscription churn</h2>
            <p>
              {pct(subscription.churnRate)}
              <span className="card-sub">
                {int(subscription.canceled)} of {int(subscription.active + subscription.canceled)} subs
              </span>
            </p>
          </article>
        </div>

        <div className="metric-segments" role="img" aria-label="Users by recency">
          {RECENCY.map((bucket) => {
            const value = retention[bucket.key];
            const share = value / recencyTotal;
            if (share <= 0) return null;
            return (
              <div
                key={bucket.key}
                className="metric-segment"
                style={{ width: `${share * 100}%`, background: bucket.color }}
                title={`${bucket.label}: ${int(value)}`}
              >
                {share >= 0.08 ? int(value) : null}
              </div>
            );
          })}
        </div>
        <div className="metric-legend">
          {RECENCY.map((bucket) => (
            <span key={bucket.key} className="metric-legend-item">
              <span className="metric-legend-swatch" style={{ background: bucket.color }} />
              {bucket.label}: <strong>{int(retention[bucket.key])}</strong>
            </span>
          ))}
        </div>
      </section>

      {/* 3 — Product-market fit. */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Product-market fit</h2>
          <span className="muted">engagement-based proxies — the closer to the right, the stronger</span>
        </div>

        <div className="stats-grid">
          <article className="card card-inset">
            <h2>Activation</h2>
            <p>
              {pct(pmf.activationRate)}
              <span className="card-sub">saved an email or built a collection</span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Stickiness</h2>
            <p>
              {pct(pmf.stickiness)}
              <span className="card-sub">DAU / MAU</span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Power users</h2>
            <p>
              {pct(pmf.powerUserRate)}
              <span className="card-sub">{int(pmf.powerUsers)} saved 5+ emails</span>
            </p>
          </article>
        </div>

        <div className="metric-bars">
          {ENGAGEMENT.map((row) => {
            const value = pmf[row.key];
            const share = value / engagementMax;
            return (
              <div key={row.key} className="metric-bar-row">
                <span className="metric-bar-label">{row.label}</span>
                <span className="metric-bar-track">
                  <span
                    className="metric-bar-fill"
                    style={{ width: `${Math.max(share, value > 0 ? 0.04 : 0) * 100}%` }}
                  />
                </span>
                <span className="metric-bar-value">{int(value)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4 — Onboarding modal: finished, skipped (where), or still pending. */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Onboarding modal</h2>
          <span className="muted">
            non-team signups since {sinceLabel(onboarding.since)} · {int(onboarding.total)} shown it
          </span>
        </div>

        <div className="stats-grid">
          <article className="card card-inset">
            <h2>Completed</h2>
            <p>
              {pct(onboarding.completionRate)}
              <span className="card-sub">
                {int(onboarding.completed)} of {int(decided)} who answered · {int(onboarding.completedPaid)} paid
              </span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Skipped</h2>
            <p>
              {int(onboarding.skipped)}
              <span className="card-sub">
                {onboarding.skipped > 0 ? `most leave at step ${skipPeak}` : "nobody yet"} · {int(onboarding.skippedPaid)} paid
              </span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Not answered yet</h2>
            <p>
              {int(onboarding.pending)}
              <span className="card-sub">signed up, haven&apos;t reached the modal</span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Named their brand</h2>
            <p>
              {int(onboarding.ownBrand)}
              <span className="card-sub">answered &ldquo;which brand do you work on?&rdquo;</span>
            </p>
          </article>
        </div>

        <div className="metric-segments" role="img" aria-label="Onboarding outcomes">
          {ONBOARDING_OUTCOMES.map((bucket) => {
            const value = onboardingCount(bucket.key);
            const share = value / onboardingTotal;
            if (share <= 0) return null;
            return (
              <div
                key={String(bucket.key)}
                className="metric-segment"
                style={{ width: `${share * 100}%`, background: bucket.color }}
                title={`${bucket.label}: ${int(value)}`}
              >
                {share >= 0.08 ? int(value) : null}
              </div>
            );
          })}
        </div>
        <div className="metric-legend">
          {ONBOARDING_OUTCOMES.map((bucket) => (
            <span key={String(bucket.key)} className="metric-legend-item">
              <span className="metric-legend-swatch" style={{ background: bucket.color }} />
              {bucket.label}: <strong>{int(onboardingCount(bucket.key))}</strong>
            </span>
          ))}
        </div>

        <div className="stats-grid">
          <article className="card card-inset">
            <h2>Roles</h2>
            {onboarding.roles.length === 0 ? (
              <p className="muted">No answers yet.</p>
            ) : (
              <div className="metric-bars">
                {onboarding.roles.map((row) => (
                  <div key={row.role} className="metric-bar-row">
                    <span className="metric-bar-label">{row.label}</span>
                    <span className="metric-bar-track">
                      <span
                        className="metric-bar-fill"
                        style={{ width: `${Math.max(row.count / roleMax, 0.04) * 100}%` }}
                      />
                    </span>
                    <span className="metric-bar-value">{int(row.count)}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="card card-inset">
            <h2>Categories picked</h2>
            {onboarding.categories.length === 0 ? (
              <p className="muted">No answers yet.</p>
            ) : (
              <div className="metric-bars">
                {onboarding.categories.map((row) => (
                  <div key={row.category} className="metric-bar-row">
                    <span className="metric-bar-label">{categoryLabel(row.category)}</span>
                    <span className="metric-bar-track">
                      <span
                        className="metric-bar-fill"
                        style={{ width: `${Math.max(row.count / categoryMax, 0.04) * 100}%` }}
                      />
                    </span>
                    <span className="metric-bar-value">{int(row.count)}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        {/* Did finishing the modal change what people did next? */}
        <div className="dashboard-panel-header">
          <h2>What they did next, by outcome</h2>
          <span className="muted">
            follows exclude the modal&apos;s own batch · &ldquo;acted&rdquo; = any save, follow, collection or comparison
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Users</th>
                <th>Acted</th>
                <th>Saved</th>
                <th>Followed later</th>
                <th>Collection</th>
                <th>Active · 7d</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {outcomeRows.map(({ key, label, row }) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{row ? int(row.total) : "0"}</td>
                  <td>{row ? share(row.acted, row.total) : "—"}</td>
                  <td>{row ? share(row.savedAny, row.total) : "—"}</td>
                  <td>{row ? share(row.followedLater, row.total) : "—"}</td>
                  <td>{row ? share(row.madeCollection, row.total) : "—"}</td>
                  <td>{row ? share(row.active7d, row.total) : "—"}</td>
                  <td>{row ? share(row.paid, row.total) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stats-grid">
          <article className="card card-inset">
            <h2>Brands requested in step 3</h2>
            <p>
              {int(onboarding.requests.total)}
              <span className="card-sub">
                {int(onboarding.requests.pending)} pending · {int(onboarding.requests.handled)} handled · from {int(onboarding.requests.users)} {onboarding.requests.users === 1 ? "person" : "people"}
              </span>
            </p>
          </article>
        </div>
      </section>

      {/* 5 — Time to first action. */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Time to first action</h2>
          <span className="muted">
            signup → first save, own follow, collection or comparison · {int(tfa.total)} non-team users
          </span>
        </div>

        <div className="stats-grid">
          <article className="card card-inset">
            <h2>Median</h2>
            <p>
              {duration(tfa.medianMinutes)}
              <span className="card-sub">75th percentile {duration(tfa.p75Minutes)} · of {int(tfa.acted)} who acted</span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Within an hour</h2>
            <p>
              {pct(tfa.total > 0 ? tfa.within1h / tfa.total : null)}
              <span className="card-sub">{int(tfa.within1h)} of everyone who signed up</span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Same day</h2>
            <p>
              {pct(tfa.total > 0 ? (tfa.within1h + tfa.within24h) / tfa.total : null)}
              <span className="card-sub">{int(tfa.within1h + tfa.within24h)} acted within 24 hours</span>
            </p>
          </article>
          <article className="card card-inset">
            <h2>Never acted</h2>
            <p>
              {int(tfa.never)}
              <span className="card-sub">{pct(tfa.total > 0 ? tfa.never / tfa.total : null)} of signups</span>
            </p>
          </article>
        </div>

        <div className="metric-segments" role="img" aria-label="Time to first action">
          {FIRST_ACTION_BUCKETS.map((bucket) => {
            const value = tfa[bucket.key];
            const s = value / tfaTotal;
            if (s <= 0) return null;
            return (
              <div
                key={bucket.key}
                className="metric-segment"
                style={{ width: `${s * 100}%`, background: bucket.color }}
                title={`${bucket.label}: ${int(value)}`}
              >
                {s >= 0.08 ? int(value) : null}
              </div>
            );
          })}
        </div>
        <div className="metric-legend">
          {FIRST_ACTION_BUCKETS.map((bucket) => (
            <span key={bucket.key} className="metric-legend-item">
              <span className="metric-legend-swatch" style={{ background: bucket.color }} />
              {bucket.label}: <strong>{int(tfa[bucket.key])}</strong>
            </span>
          ))}
        </div>
      </section>

      {/* 6 — Upgrade prompts by source. */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Upgrade prompts</h2>
          <span className="muted">
            which CTA gets clicked, and how many clickers now pay · anonymous clicks count towards clicks only
          </span>
        </div>
        {upgradePrompts.length === 0 ? (
          <p className="muted">No upgrade clicks captured yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Clicks</th>
                  <th>Last 30d</th>
                  <th>Users</th>
                  <th>Now paying</th>
                  <th>Last click</th>
                </tr>
              </thead>
              <tbody>
                {upgradePrompts.map((row) => (
                  <tr key={row.source}>
                    <td title={row.source}>{row.label}</td>
                    <td>{int(row.clicks)}</td>
                    <td>{int(row.clicks30d)}</td>
                    <td>{int(row.users)}</td>
                    <td>{share(row.converted, row.users)}</td>
                    <td className="muted">{when(row.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7 — Where signups come from. */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Where signups come from</h2>
          <span className="muted">
            the button or flow that created the account · accounts from before tracking show as unknown
          </span>
        </div>
        {signupSources.length === 0 ? (
          <p className="muted">No signups yet.</p>
        ) : (
          <div className="metric-bars">
            {signupSources.map((row) => (
              <div key={row.source} className="metric-bar-row">
                <span className="metric-bar-label">{row.label}</span>
                <span className="metric-bar-track">
                  <span
                    className="metric-bar-fill"
                    style={{ width: `${Math.max(row.total / sourceMax, 0.04) * 100}%` }}
                  />
                </span>
                <span className="metric-bar-value">
                  {int(row.total)} · {int(row.last30d)} in 30d · {int(row.paid)} paid
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 8 — Activation funnel (my pick). */}
      <section className="card dashboard-panel">
        <div className="dashboard-panel-header">
          <h2>Activation funnel</h2>
          <span className="muted">how far non-team users travel from signup to paid</span>
        </div>
        <div className="funnel">
          {funnel.map((stage, i) => {
            const share = stage.count / funnelTop;
            const fromTop = funnelTop > 0 ? stage.count / funnelTop : 0;
            const prev = funnel[i - 1]?.count ?? null;
            const step = prev && prev > 0 ? stage.count / prev : null;
            return (
              <div key={stage.key} className="funnel-row">
                <span className="funnel-label">{stage.label}</span>
                <span className="funnel-bar">
                  <span
                    className="funnel-bar-fill"
                    style={{ width: `${Math.max(share, stage.count > 0 ? 0.04 : 0) * 100}%` }}
                  >
                    {int(stage.count)}
                  </span>
                </span>
                <span className="funnel-meta">
                  {pct(fromTop)}
                  {i > 0 && step !== null ? <em> · {pct(step)} step</em> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
