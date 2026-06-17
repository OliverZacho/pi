import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getUpgradeClickStats } from "@/lib/upgrade-clicks-db";
import styles from "./upgrades.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Upgrade clicks — Admin — Pirol",
  robots: { index: false, follow: false }
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * Admin dashboard for upgrade-CTA clicks. Ranks every "Upgrade" / "Subscribe"
 * button by how often it's clicked, so we can see which surfaces drive the
 * most upgrade intent. Gated by the admin layout.
 */
export default async function UpgradeClicksPage() {
  const stats = await getUpgradeClickStats(getSupabaseAdmin(), {
    windowDays: 30
  });

  const maxDay = Math.max(1, ...stats.daily.map((d) => d.count));
  const maxSource = Math.max(1, ...stats.sources.map((s) => s.total));

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <Link href="/admin" className={styles.back}>
          ← Admin
        </Link>
        <h1 className={styles.title}>Upgrade clicks</h1>
        <p className={styles.sub}>
          Every upgrade / subscribe CTA, ranked by clicks. Counts include
          logged-out visitors.
        </p>
      </header>

      <section className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{stats.total.toLocaleString()}</span>
          <span className={styles.kpiLabel}>Total clicks (all time)</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{stats.total7.toLocaleString()}</span>
          <span className={styles.kpiLabel}>Last 7 days</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{stats.sources.length}</span>
          <span className={styles.kpiLabel}>Active sources</span>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Last {stats.windowDays} days</h2>
        <div className={styles.spark}>
          {stats.daily.map((d) => (
            <span
              key={d.date}
              className={styles.sparkBar}
              style={{ height: `${Math.max(2, (d.count / maxDay) * 100)}%` }}
              title={`${d.date}: ${d.count} click${d.count === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>By source</h2>
        {stats.sources.length === 0 ? (
          <p className={styles.empty}>No clicks recorded yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Source</th>
                <th className={styles.num}>Total</th>
                <th className={styles.num}>Last 7d</th>
                <th className={styles.num}>Last click</th>
                <th className={styles.barCol}>Share</th>
              </tr>
            </thead>
            <tbody>
              {stats.sources.map((s) => (
                <tr key={s.source}>
                  <td>
                    <span className={styles.sourceLabel}>{s.label}</span>
                    <span className={styles.sourceTag}>{s.source}</span>
                  </td>
                  <td className={styles.num}>{s.total.toLocaleString()}</td>
                  <td className={styles.num}>{s.last7.toLocaleString()}</td>
                  <td className={styles.num}>{formatDateTime(s.lastClickAt)}</td>
                  <td className={styles.barCol}>
                    <span className={styles.track}>
                      <span
                        className={styles.fill}
                        style={{ width: `${(s.total / maxSource) * 100}%` }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
