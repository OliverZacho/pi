"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./pricing.module.css";

type Billing = "monthly" | "annual";

type Plan = {
  id: string;
  name: string;
  blurb: string;
  monthly: number;
  /** Annual total — set to 10× monthly so the customer gets two months free. */
  annual: number;
  featured?: boolean;
  cta: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: "solo",
    name: "Solo",
    blurb: "For the individual marketer studying the competition.",
    monthly: 29,
    annual: 290,
    cta: "Get Solo",
    features: [
      "1 seat",
      "Full access to the entire email archive",
      "Unlimited search across every brand",
      "Unlimited saves & collections",
      "Compare brands side by side",
      "Stats & analytics dashboards",
    ],
  },
  {
    id: "team",
    name: "Team",
    blurb: "For marketing teams and agencies working together.",
    monthly: 89,
    annual: 890,
    featured: true,
    cta: "Get Team",
    features: [
      "Up to 6 seats",
      "Everything in Solo",
      "Shared team collections",
      "Compare brands side by side",
      "Stats & analytics dashboards",
      "Priority support",
    ],
  },
];

/** Per-month figure shown on the card, rounded for display. */
function perMonth(plan: Plan, billing: Billing): number {
  return billing === "annual" ? Math.round(plan.annual / 12) : plan.monthly;
}

export default function Pricing() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <section className={styles.section} aria-labelledby="pricing-heading">
      <div className={styles.head}>
        <h1 id="pricing-heading" className={styles.title}>
          Simple pricing. The whole archive.
        </h1>
        <p className={styles.subtitle}>
          One plan unlocks everything — every email, every brand, every dashboard.
          No tiers of features to decode, no usage meters to watch.
        </p>

        <div
          className={styles.toggle}
          role="radiogroup"
          aria-label="Billing period"
        >
          <button
            type="button"
            role="radio"
            aria-checked={billing === "monthly"}
            className={`${styles.toggleBtn} ${
              billing === "monthly" ? styles.toggleActive : ""
            }`}
            onClick={() => setBilling("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={billing === "annual"}
            className={`${styles.toggleBtn} ${
              billing === "annual" ? styles.toggleActive : ""
            }`}
            onClick={() => setBilling("annual")}
          >
            Annual
            <span className={styles.toggleBadge}>2 months free</span>
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`${styles.card} ${plan.featured ? styles.cardFeatured : ""}`}
          >
            {plan.featured ? (
              <span className={styles.ribbon}>Best value</span>
            ) : null}

            <div className={styles.cardHead}>
              <h2 className={styles.planName}>{plan.name}</h2>
              <p className={styles.planBlurb}>{plan.blurb}</p>
            </div>

            <div className={styles.priceRow}>
              <span className={styles.currency}>€</span>
              <span className={styles.price}>{perMonth(plan, billing)}</span>
              <span className={styles.per}>/mo</span>
            </div>
            <p className={styles.billingNote}>
              {billing === "annual"
                ? `€${plan.annual.toLocaleString()} billed yearly`
                : "billed monthly"}
            </p>

            <Link
              href="/login"
              className={`${styles.cta} ${
                plan.featured ? styles.ctaPrimary : styles.ctaGhost
              }`}
            >
              {plan.cta}
            </Link>

            <ul className={styles.features}>
              {plan.features.map((feature) => (
                <li key={feature} className={styles.feature}>
                  <svg
                    className={styles.check}
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m5 10.5 3.2 3.2L15 6.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className={styles.guarantee}>
        Not for you? Email us within 7 days for a full refund — no questions asked.
      </p>
    </section>
  );
}
