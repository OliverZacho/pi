"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./plan-choice.module.css";

type Billing = "monthly" | "annual";

type Plan = {
  id: "free" | "solo" | "team";
  name: string;
  blurb: string;
  monthly: number;
  /** Annual total — 10× monthly, so the customer gets two months free. */
  annual: number;
  featured?: boolean;
  cta: string;
  features: string[];
};

// Mirrors the marketing /pricing cards so the two stay in step. Kept local so
// the modal is self-contained (the marketing copy lives in a separate module).
const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    blurb: "Get a feel for the archive. No card required.",
    monthly: 0,
    annual: 0,
    cta: "Continue with Free",
    features: [
      "Preview the entire archive",
      "Search & filter across every brand",
      "Save up to 25 emails"
    ]
  },
  {
    id: "solo",
    name: "Solo",
    blurb: "For the individual marketer studying the competition.",
    monthly: 29,
    annual: 290,
    cta: "Get Solo",
    features: [
      "Full access to the entire archive",
      "Unlimited saves & collections",
      "Compare brands side by side",
      "Stats & analytics dashboards"
    ]
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
      "Priority support"
    ]
  }
];

/** Per-month figure shown on the card, rounded for display. */
function perMonth(plan: Plan, billing: Billing): number {
  return billing === "annual" ? Math.round(plan.annual / 12) : plan.monthly;
}

/**
 * Forced onboarding choice shown to brand-new signups on /explore. It cannot be
 * dismissed — every new user picks Free, Solo or Team before reaching the app.
 * Free closes the modal in place; Solo/Team currently run the temporary
 * free-grant bridge (see /api/select-plan) and bounce through /explore?upgraded=1.
 */
export default function PlanChoiceModal() {
  const router = useRouter();
  const [billing, setBilling] = useState<Billing>("annual");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(planId: Plan["id"]) {
    setPending(planId);
    setError(null);
    try {
      const res = await fetch("/api/select-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId })
      });
      const data: { ok?: boolean; redirect?: string | null; error?: string } =
        await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Could not save your choice");
      }
      if (data.redirect) {
        // Paid grant — hard navigate so entitlement re-resolves server-side.
        window.location.assign(data.redirect);
        return;
      }
      // Free — the choice is stamped, so a refresh drops the modal in place.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your choice");
      setPending(null);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-choice-title"
    >
      <div className={styles.modal}>
        <header className={styles.head}>
          <h2 id="plan-choice-title" className={styles.title}>
            Welcome to Pirol — pick your plan
          </h2>
          <p className={styles.subtitle}>
            Choose how you want to start. You can change this anytime.
          </p>

          <div className={styles.billingToggle} role="group" aria-label="Billing period">
            <button
              type="button"
              className={billing === "monthly" ? styles.billingActive : styles.billingOption}
              onClick={() => setBilling("monthly")}
              aria-pressed={billing === "monthly"}
            >
              Monthly
            </button>
            <button
              type="button"
              className={billing === "annual" ? styles.billingActive : styles.billingOption}
              onClick={() => setBilling("annual")}
              aria-pressed={billing === "annual"}
            >
              Annual <span className={styles.saveTag}>2 months free</span>
            </button>
          </div>
        </header>

        <div className={styles.cards}>
          {PLANS.map((plan) => {
            const price = perMonth(plan, billing);
            const isPending = pending === plan.id;
            return (
              <div
                key={plan.id}
                className={plan.featured ? styles.cardFeatured : styles.card}
              >
                {plan.featured ? <span className={styles.badge}>Most popular</span> : null}
                <h3 className={styles.planName}>{plan.name}</h3>
                <p className={styles.planBlurb}>{plan.blurb}</p>
                <div className={styles.price}>
                  {price === 0 ? (
                    <span className={styles.priceAmount}>Free</span>
                  ) : (
                    <>
                      <span className={styles.priceAmount}>${price}</span>
                      <span className={styles.priceUnit}>/mo</span>
                    </>
                  )}
                </div>
                {price > 0 && billing === "annual" ? (
                  <p className={styles.priceNote}>billed ${plan.annual}/yr</p>
                ) : (
                  <p className={styles.priceNote}>&nbsp;</p>
                )}

                <ul className={styles.features}>
                  {plan.features.map((feature) => (
                    <li key={feature} className={styles.feature}>
                      <svg className={styles.check} viewBox="0 0 20 20" aria-hidden="true">
                        <path d="m5 10 3.5 3.5L15 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className={plan.id === "free" ? styles.ctaSecondary : styles.ctaPrimary}
                  onClick={() => choose(plan.id)}
                  disabled={pending !== null}
                >
                  {isPending ? "One moment…" : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </div>
  );
}
