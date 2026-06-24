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

  const { totals, growth, retention, subscription, pmf, funnel } = metrics;
  const recencyTotal = Math.max(retention.realTotal, 1);
  const engagementMax = Math.max(pmf.mau, 1);
  const funnelTop = Math.max(funnel[0]?.count ?? 0, 1);

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

      {/* 4 — Activation funnel (my pick). */}
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
