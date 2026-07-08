"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Caveat } from "next/font/google";
import styles from "./plan-choice.module.css";
import CheckoutAuthFlow from "./CheckoutAuthFlow";
import { perMonthLabel } from "@/lib/pricing";

/** Handwritten face for the "2 months free!" annotation by the toggle. */
const caveat = Caveat({ subsets: ["latin"], weight: "600" });

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
    monthly: 30,
    annual: 300,
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
    monthly: 90,
    annual: 900,
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


/**
 * The plan picker. Two modes share one component:
 *
 *  - Onboarding (no `onClose`): the forced choice shown to brand-new signups on
 *    /explore. It cannot be dismissed — every new user picks Free, Solo or Team
 *    before reaching the app. Free closes the modal in place by stamping the
 *    choice and refreshing.
 *  - Upgrade (with `onClose`): the same cards opened on demand when an existing
 *    free user clicks any in-app upgrade CTA. It's dismissible (×, Esc, overlay
 *    click) and the Free card simply closes — the user already has that tier.
 *
 * Free stamps the onboarding choice via /api/select-plan; Solo/Team hand off to
 * Stripe Checkout (/api/checkout) in both modes.
 */
export default function PlanChoiceModal({
  onClose
}: {
  /** When provided, the modal becomes a dismissible on-demand upgrade prompt. */
  onClose?: () => void;
} = {}) {
  const router = useRouter();
  const [billing, setBilling] = useState<Billing>("annual");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When a logged-out visitor picks a paid plan, we swap the cards for an
  // inline email-verify step (this holds which plan they're buying) and resume
  // checkout once they have a session.
  const [verifyPlan, setVerifyPlan] = useState<"solo" | "team" | null>(null);

  const dismissible = typeof onClose === "function";

  // Esc closes the dismissible (upgrade) variant; the forced onboarding variant
  // ignores it so new signups can't skip the choice.
  useEffect(() => {
    if (!dismissible) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && pending === null) onClose?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissible, onClose, pending]);

  /**
   * POST `/api/checkout` for a paid plan and hand off to Stripe on success.
   * Returns "unauth" when there's no session yet, so the caller can show the
   * inline email-verify step and retry once the visitor is signed in.
   */
  async function startPaidCheckout(
    planId: "solo" | "team"
  ): Promise<"unauth" | void> {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId, billing })
    });
    if (res.status === 401) return "unauth";
    const data: { url?: string; error?: string } = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.error ?? "Could not start checkout");
    }
    window.location.assign(data.url);
  }

  async function choose(planId: Plan["id"]) {
    // In upgrade mode the user is already on Free — just close, no round-trip.
    if (dismissible && planId === "free") {
      onClose?.();
      return;
    }
    setPending(planId);
    setError(null);
    try {
      if (planId === "free") {
        // Stamp the onboarding choice so the forced modal stops showing.
        const res = await fetch("/api/select-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: planId })
        });
        const data: { ok?: boolean; error?: string } = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? "Could not save your choice");
        }
        // The choice is stamped, so a refresh drops the modal in place.
        router.refresh();
        return;
      }

      const result = await startPaidCheckout(planId);
      if (result === "unauth") {
        // Logged-out visitor — verify their email inline, then resume checkout.
        setVerifyPlan(planId);
        setPending(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your choice");
      setPending(null);
    }
  }

  // Logged-out visitor picked a paid plan — hand off to the split-screen
  // account/checkout flow, which keeps the plan they're buying in view while
  // they create an account (or log in) and then resumes checkout.
  if (verifyPlan) {
    const chosen = PLANS.find((pl) => pl.id === verifyPlan);
    if (chosen) {
      return (
        <CheckoutAuthFlow
          plan={{
            id: verifyPlan,
            name: chosen.name,
            monthly: chosen.monthly,
            annual: chosen.annual,
            features: chosen.features
          }}
          billing={billing}
          onBack={() => {
            setVerifyPlan(null);
            setPending(null);
            setError(null);
          }}
          onClose={dismissible ? onClose : undefined}
        />
      );
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-choice-title"
      onClick={
        dismissible
          ? (event) => {
              // Click on the backdrop (not the modal body) closes it.
              if (event.target === event.currentTarget && pending === null) {
                onClose?.();
              }
            }
          : undefined
      }
    >
      <div className={styles.modal}>
        {dismissible ? (
          <button
            type="button"
            className={styles.close}
            onClick={() => onClose?.()}
            disabled={pending !== null}
            aria-label="Close"
          >
            ×
          </button>
        ) : null}
        <header className={styles.head}>
          <h2 id="plan-choice-title" className={styles.title}>
            {dismissible ? "Upgrade your plan" : "Welcome to Pirol — pick your plan"}
          </h2>
          <p className={styles.subtitle}>
            {dismissible
              ? "Unlock the full archive and every feature. Change or cancel anytime."
              : "Choose how you want to start. You can change this anytime."}
          </p>

          <div className={styles.billingToggleWrap}>
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
                Annual
                {/* Pill shows on small screens only; on desktop the
                    handwritten annotation takes over (badge stays for
                    screen readers). */}
                <span className={styles.saveTag}>2 months free</span>
              </button>
            </div>

            <span className={`${styles.annot} ${caveat.className}`} aria-hidden="true">
              <svg className={styles.annotArrow} viewBox="0 0 52 46" fill="none">
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
        </header>

        <div className={styles.cards}>
          {PLANS.map((plan) => {
            const isFree = plan.monthly === 0 && plan.annual === 0;
            const priceLabel = perMonthLabel(
              plan.monthly,
              plan.annual,
              billing === "annual"
            );
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
                  {isFree ? (
                    <span className={styles.priceAmount}>Free</span>
                  ) : (
                    <>
                      <span className={styles.priceAmount}>€{priceLabel}</span>
                      <span className={styles.priceUnit}>/mo</span>
                    </>
                  )}
                </div>
                {!isFree && billing === "annual" ? (
                  <p className={styles.priceNote}>billed €{plan.annual}/yr</p>
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
                  {isPending
                    ? "One moment…"
                    : dismissible && plan.id === "free"
                      ? "Stay on Free"
                      : plan.cta}
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
