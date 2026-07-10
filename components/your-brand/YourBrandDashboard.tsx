"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  YourBrandInsight,
  YourBrandInsightId
} from "@/lib/your-brand-insights";
import styles from "./your-brand.module.css";

/**
 * Client half of the "Your brand" tab: the insight cards with their
 * hide / restore controls, and the competitor-set picker that powers the
 * peer-based rules.
 *
 * All rule evaluation happens server-side; this component only decides
 * which already-fired insights are visible. Hiding is optimistic: the
 * card moves immediately and the pref write happens in the background —
 * a failed write costs the user one re-hide, never a blocked UI.
 */

export type ComparisonOption = {
  id: string;
  name: string;
  brandCount: number;
};

type Props = {
  insights: YourBrandInsight[];
  initialDismissed: YourBrandInsightId[];
  /** The viewer's saved comparisons, for the peer-set picker. */
  comparisonOptions: ComparisonOption[];
  selectedSetId: string | null;
  /** How many peer brands actually loaded from the selected set. */
  peerCount: number;
};

async function putPrefs(prefs: {
  dismissed: YourBrandInsightId[];
  competitorSetId: string | null;
}) {
  try {
    await fetch("/api/your-brand/prefs", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs)
    });
  } catch {
    // Optimistic UI: a dropped write is re-creatable with one click and
    // not worth an error banner on an insights page.
  }
}

export default function YourBrandDashboard({
  insights,
  initialDismissed,
  comparisonOptions,
  selectedSetId,
  peerCount
}: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] =
    useState<YourBrandInsightId[]>(initialDismissed);
  const [setId, setSetId] = useState<string | null>(selectedSetId);
  const [showHidden, setShowHidden] = useState(false);

  const visible = useMemo(
    () => insights.filter((insight) => !dismissed.includes(insight.id)),
    [insights, dismissed]
  );
  const hidden = useMemo(
    () => insights.filter((insight) => dismissed.includes(insight.id)),
    [insights, dismissed]
  );

  function hide(id: YourBrandInsightId) {
    const next = dismissed.includes(id) ? dismissed : [...dismissed, id];
    setDismissed(next);
    void putPrefs({ dismissed: next, competitorSetId: setId });
  }

  function restore(id: YourBrandInsightId) {
    const next = dismissed.filter((entry) => entry !== id);
    setDismissed(next);
    void putPrefs({ dismissed: next, competitorSetId: setId });
  }

  function selectSet(value: string) {
    const next = value === "" ? null : value;
    setSetId(next);
    void putPrefs({ dismissed, competitorSetId: next }).then(() => {
      // Peer rules are evaluated server-side, so re-render the page with
      // the new comparison group.
      router.refresh();
    });
  }

  const hasPeers = setId !== null && peerCount >= 2;

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeadRow}>
          <div>
            <div className={styles.sectionEyebrow}>This week&apos;s read</div>
            <h2 className={styles.sectionTitle}>
              {visible.length === 0
                ? "Nothing needs your attention"
                : `${visible.length} thing${visible.length === 1 ? "" : "s"} worth a look`}
            </h2>
            <p className={styles.sectionSub}>
              Checks only appear when the data says there is something to
              decide. Hide the ones you have made a call on, they stay
              available under hidden insights.
            </p>
          </div>
          {hidden.length > 0 ? (
            <button
              type="button"
              className={styles.hiddenToggle}
              onClick={() => setShowHidden((current) => !current)}
              aria-expanded={showHidden}
            >
              <EyeOffIcon />
              {showHidden
                ? "Close hidden insights"
                : `Hidden insights (${hidden.length})`}
            </button>
          ) : null}
        </div>

        <div className={styles.sectionBody}>
          {visible.length === 0 ? (
            <p className={styles.allClear}>
              <span className={styles.allClearIcon}>
                <CheckIcon />
              </span>
              Every check passed on your recent emails
              {hidden.length > 0
                ? ", aside from the ones you chose to hide."
                : ". We keep checking as new sends come in."}
            </p>
          ) : (
            <div className={styles.cardGrid}>
              {visible.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  action={
                    <button
                      type="button"
                      className={styles.hideBtn}
                      onClick={() => hide(insight.id)}
                      title="Hide this insight. Restore it any time from hidden insights."
                    >
                      <EyeOffIcon />
                      Hide
                    </button>
                  }
                />
              ))}
            </div>
          )}

          {showHidden && hidden.length > 0 ? (
            <div className={styles.hiddenBlock}>
              <p className={styles.hiddenBlockLabel}>
                Hidden insights. These checks still fire on your data, you
                chose not to be reminded.
              </p>
              <div className={styles.cardGrid}>
                {hidden.map((insight) => (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    muted
                    action={
                      <button
                        type="button"
                        className={styles.restoreBtn}
                        onClick={() => restore(insight.id)}
                      >
                        Show again
                      </button>
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionEyebrow}>Competitive checks</div>
        <h2 className={styles.sectionTitle}>Compare against your competitors</h2>
        <p className={styles.sectionSub}>
          Send timing, cadence and urgency checks need a group to compare
          against. Pick one of your saved comparisons, the checks use its
          brands as your peer group.
        </p>
        <div className={styles.sectionBody}>
          <div className={styles.peerRow}>
            {comparisonOptions.length > 0 ? (
              <>
                <select
                  className={styles.peerSelect}
                  value={setId ?? ""}
                  onChange={(event) => selectSet(event.target.value)}
                  aria-label="Comparison group for competitive checks"
                >
                  <option value="">No comparison selected</option>
                  {comparisonOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.brandCount} brand
                      {option.brandCount === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
                {setId === null ? (
                  <span className={styles.peerHint}>
                    Competitive checks are off until you pick a group.
                  </span>
                ) : !hasPeers ? (
                  <span className={styles.peerHint}>
                    That group needs at least 2 other brands for a fair
                    comparison.
                  </span>
                ) : (
                  <span className={styles.peerHint}>
                    Comparing against {peerCount} brands.
                  </span>
                )}
              </>
            ) : (
              <span className={styles.peerHint}>
                You have no saved comparisons yet.
              </span>
            )}
            <Link href="/compare#build" className={styles.peerCreateLink}>
              Build a comparison on the Comparisons page
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function InsightCard({
  insight,
  action,
  muted = false
}: {
  insight: YourBrandInsight;
  action: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <article
      className={`${styles.card}${muted ? ` ${styles.cardHidden}` : ""}`}
    >
      <div className={styles.cardTop}>
        <span
          className={`${styles.kindBadge} ${
            insight.kind === "fix" ? styles.kindFix : styles.kindConsider
          }`}
        >
          {insight.kind === "fix" ? <WrenchIcon /> : <SparkIcon />}
          {insight.kind === "fix" ? "Worth fixing" : "Worth considering"}
        </span>
        {insight.usesPeers ? (
          <span className={styles.peerBadge}>vs competitors</span>
        ) : null}
      </div>
      <h3 className={styles.cardTitle}>{insight.title}</h3>
      <p className={styles.cardBody}>{insight.body}</p>
      <div className={styles.cardFoot}>
        {insight.learnHref ? (
          <Link href={insight.learnHref} className={styles.learnLink}>
            How this works, on the Learn page
          </Link>
        ) : (
          <span />
        )}
        {action}
      </div>
    </article>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.3.8-1 2-2.2 3.2M6.2 6.2C4 7.7 2.5 10 2 12c1 2.5 5 7 10 7 1.5 0 2.9-.4 4.1-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5.5" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3z" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}
