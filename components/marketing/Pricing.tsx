"use client";

import { useState } from "react";
import Link from "next/link";
import { Caveat } from "next/font/google";
import styles from "./pricing.module.css";
import PricingCompare from "./PricingCompare";

/** Handwritten face for the "2 months free!" annotation by the toggle. */
const caveat = Caveat({ subsets: ["latin"], weight: "600" });

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
    id: "free",
    name: "Free",
    blurb: "For getting a feel for the archive. No card required.",
    monthly: 0,
    annual: 0,
    cta: "Create free account",
    features: [
      "Preview the entire archive",
      "Search & filter across every brand",
      "Save up to 25 emails",
      "Email breakdowns: ESP, category & design"
    ],
  },
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
  // Annual is the default — it's the better deal (two months free) and
  // the price shown first anchors the decision.
  const [billing, setBilling] = useState<Billing>("annual");
  // Which paid plan is mid-checkout, so we can disable its button and show a
  // pending label without blocking the other card.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(planId: string) {
    setPending(planId);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planId,
          billing: billing === "annual" ? "annual" : "monthly",
        }),
      });
      // Not signed in — send them to sign up, then back to pricing.
      if (res.status === 401) {
        window.location.assign("/login?next=/pricing");
        return;
      }
      const data: { url?: string; error?: string } = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Could not start checkout");
      }
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setPending(null);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="pricing-heading">
      <div className={styles.head}>
        <h1 id="pricing-heading" className={styles.title}>
          Simple pricing. The whole archive.
        </h1>
        <p className={styles.subtitle}>
          Start free, no card required. One upgrade unlocks everything — every
          email, every brand, every dashboard.
        </p>

        <div className={styles.toggleWrap}>
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
              {/* Pill shows on small screens only; on desktop the
                  handwritten annotation takes over (badge stays for
                  screen readers). */}
              <span className={styles.toggleBadge}>2 months free</span>
            </button>
          </div>

          <span
            className={`${styles.annot} ${caveat.className}`}
            aria-hidden="true"
          >
            <svg
              className={styles.annotArrow}
              viewBox="0 0 52 46"
              fill="none"
            >
              {/* Sweeps from the note down-left, tip pointing down at the
                  Annual button below. */}
              <path
                d="M48 6 C 32 4, 14 12, 9 36"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="M3 29 L9 38 L17 31"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={styles.annotText}>
              2 months
              <br />
              free!
            </span>
          </span>
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
              {plan.monthly === 0
                ? "free forever"
                : billing === "annual"
                  ? `€${plan.annual.toLocaleString()} billed yearly`
                  : "billed monthly"}
            </p>

            {plan.id === "free" ? (
              <Link
                href="/login"
                className={`${styles.cta} ${
                  plan.featured ? styles.ctaPrimary : styles.ctaGhost
                }`}
              >
                {plan.cta}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => startCheckout(plan.id)}
                disabled={pending !== null}
                className={`${styles.cta} ${
                  plan.featured ? styles.ctaPrimary : styles.ctaGhost
                }`}
              >
                {pending === plan.id ? "Redirecting…" : plan.cta}
              </button>
            )}

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

      {error ? (
        <p className={styles.guarantee} role="alert">
          {error}
        </p>
      ) : null}

      <p className={styles.guarantee}>
        Not for you? Email us within 7 days for a full refund — no questions asked.
      </p>

      <PricingCompare />
    </section>
  );
}
