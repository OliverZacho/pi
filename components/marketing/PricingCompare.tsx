"use client";

import { useState } from "react";
import styles from "./pricing.module.css";

/** A cell is either included/excluded or a short literal like "Up to 25". */
type CompareValue = boolean | string;

type CompareRow = {
  id: string;
  label: string;
  /** Shown when the feature name is expanded — written as plain prose so
   *  crawlers and answer engines can quote it directly. */
  description: string;
  /** Values in plan order: Free, Solo, Team. */
  values: [CompareValue, CompareValue, CompareValue];
};

const COMPARE_PLANS = ["Free", "Solo", "Team"] as const;
const FEATURED_PLAN = "Team";

const COMPARE_ROWS: CompareRow[] = [
  {
    id: "seats",
    label: "Users",
    description:
      "How many people can sign in. Free and Solo are single-seat; Team includes up to 6 seats so the whole team works from one shared archive.",
    values: ["1 user", "1 user", "Up to 6 users"],
  },
  {
    id: "archive",
    label: "Email archive",
    description:
      "Browse every brand and every email — nothing in the catalogue is hidden. On Free, emails open as previews; paid plans unlock the complete original email, including its links and source.",
    values: ["Preview", "Full access", "Full access"],
  },
  {
    id: "search",
    label: "Search & filters",
    description:
      "Search across every brand in the archive and narrow down by ESP, category and design — included on every plan.",
    values: [true, true, true],
  },
  {
    id: "breakdowns",
    label: "Email breakdowns",
    description:
      "Each email comes with a breakdown of its sending platform (ESP), campaign category and design, so you can see how it was built — not just what it looks like.",
    values: [true, true, true],
  },
  {
    id: "saves",
    label: "Saved emails",
    description:
      "Bookmark emails to come back to later. Free accounts can save up to 25 emails; paid plans have no limit.",
    values: ["Up to 25", "Unlimited", "Unlimited"],
  },
  {
    id: "collections",
    label: "Collections",
    description:
      "Group saved emails into named collections — swipe files for launches, flows or seasonal campaigns.",
    values: [false, true, true],
  },
  {
    id: "compare",
    label: "Compare brands",
    description:
      "Put two brands side by side to compare sending frequency, category mix and design choices.",
    values: [false, true, true],
  },
  {
    id: "dashboards",
    label: "Stats & analytics",
    description:
      "Dashboards across the archive: sending volume, category trends and how a brand's program changes over time.",
    values: [false, true, true],
  },
  {
    id: "shared-collections",
    label: "Shared team collections",
    description:
      "Collections everyone on the team can see and add to, so research lives in one shared space instead of six private ones.",
    values: [false, false, true],
  },
  {
    id: "support",
    label: "Priority support",
    description: "Your questions answered first, straight from the team.",
    values: [false, false, true],
  },
];

function CellValue({ value }: { value: CompareValue }) {
  if (typeof value === "string") {
    return <span className={styles.cellText}>{value}</span>;
  }
  return value ? (
    <span className={styles.cellCheck}>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="m5 10.5 3.2 3.2L15 6.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.srOnly}>Included</span>
    </span>
  ) : (
    <span className={styles.cellDash} aria-hidden="true">
      —<span className={styles.srOnly}>Not included</span>
    </span>
  );
}

export default function PricingCompare() {
  const [openRow, setOpenRow] = useState<string | null>(null);

  return (
    <div className={styles.compare}>
      <h2 className={styles.compareTitle}>Compare plans & features</h2>

      <div className={styles.compareScroll}>
        <table className={styles.compareTable}>
          <thead>
            <tr>
              <th scope="col" className={styles.compareHeadFeature}>
                <span className={styles.srOnly}>Feature</span>
              </th>
              {COMPARE_PLANS.map((plan) => (
                <th
                  key={plan}
                  scope="col"
                  className={`${styles.compareHeadPlan} ${
                    plan === FEATURED_PLAN ? styles.colFeatured : ""
                  }`}
                >
                  {plan}
                </th>
              ))}
            </tr>
          </thead>
          {COMPARE_ROWS.map((row) => {
            const open = openRow === row.id;
            return (
              <tbody key={row.id} className={styles.compareGroup}>
                <tr>
                  <th scope="row" className={styles.compareFeatureCell}>
                    <button
                      type="button"
                      className={styles.featureBtn}
                      aria-expanded={open}
                      aria-controls={`compare-desc-${row.id}`}
                      onClick={() => setOpenRow(open ? null : row.id)}
                    >
                      {row.label}
                      <svg
                        className={`${styles.featureChevron} ${
                          open ? styles.featureChevronOpen : ""
                        }`}
                        viewBox="0 0 20 20"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="m6 8 4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </th>
                  {row.values.map((value, i) => (
                    <td
                      key={COMPARE_PLANS[i]}
                      className={`${styles.compareValueCell} ${
                        COMPARE_PLANS[i] === FEATURED_PLAN
                          ? styles.colFeatured
                          : ""
                      }`}
                    >
                      <CellValue value={value} />
                    </td>
                  ))}
                </tr>
                {/* Kept in the DOM when closed (hidden attr) so the copy is
                    always present in the HTML for crawlers. */}
                <tr
                  id={`compare-desc-${row.id}`}
                  className={styles.compareDescRow}
                  hidden={!open}
                >
                  <td className={styles.compareDescCell}>{row.description}</td>
                  {COMPARE_PLANS.map((plan) => (
                    <td
                      key={plan}
                      className={`${styles.compareDescSpacer} ${
                        plan === FEATURED_PLAN ? styles.colFeatured : ""
                      }`}
                    />
                  ))}
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
