"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MAX_ONBOARDING_FOLLOWS,
  MIN_ONBOARDING_FOLLOWS,
  type OnboardingRole
} from "@/lib/onboarding";
import OnboardingStepRole from "./OnboardingStepRole";
import OnboardingStepCategories from "./OnboardingStepCategories";
import OnboardingStepFollow from "./OnboardingStepFollow";
import type {
  OnboardingTrackedBrand,
  OnboardingUntrackedBrand
} from "./OnboardingBrandSearch";
import styles from "./onboarding.module.css";

/** One step-3 selection: a followable tracked brand or a requestable
 *  untracked one. `key` is the toggle identity (company id / domain). */
export type OnboardingPick =
  | { kind: "tracked"; key: string; brand: OnboardingTrackedBrand }
  | { kind: "untracked"; key: string; brand: OnboardingUntrackedBrand };

export type OwnBrandAnswer = { name: string; domain: string | null };

type Props = {
  /** Raw market slugs currently in use, for the step-2 chips. */
  markets: string[];
  /** Server-fetched most-active brands seeding step 3's grid. */
  initialPopular: OnboardingTrackedBrand[];
};

const STEP_TITLES: Record<1 | 2 | 3, { title: string; subtitle: string }> = {
  1: {
    title: "Welcome to Pirol 👋",
    subtitle: "A few quick questions so we can set up your feed."
  },
  2: {
    title: "What do you want to see?",
    subtitle: "Pick the categories you care about. They shape your suggestions."
  },
  3: {
    title: "Follow your first brands",
    subtitle:
      "Their emails gather in your Following feed. Search for any brand, even ones we don't track yet."
  }
};

/**
 * The 3-step new-signup onboarding modal (role, categories, follow brands),
 * replacing the old guided tour. Mounted by the app-shell layout for any
 * signed-in user whose `onboarding_completed_at` is null; deliberately not
 * dismissible via backdrop, Esc or a close button — the exits are the
 * subtle "Skip for now" link (permanent skip) and completing step 3 with
 * 3 to 20 picks. Completion and skip both go through
 * POST /api/onboarding/complete, which stamps the profile so the modal
 * never shows again.
 */
export default function OnboardingModal(props: Props) {
  // useSearchParams needs a Suspense boundary when rendered from a server
  // layout; the gate below reads it to stay hidden during ?team_welcome=1.
  return (
    <Suspense fallback={null}>
      <OnboardingModalInner {...props} />
    </Suspense>
  );
}

function OnboardingModalInner({ markets, initialPopular }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [role, setRole] = useState<OnboardingRole | null>(null);
  const [ownBrand, setOwnBrand] = useState<OwnBrandAnswer | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [picks, setPicks] = useState<OnboardingPick[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A freshly invited teammate lands with ?team_welcome=1 and sees the
  // team welcome modal first; dismissing it strips the param, which
  // un-suppresses this modal.
  const suppressed = searchParams.get("team_welcome") === "1";
  const visible = !done && !suppressed;

  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [visible]);

  const answerFields = useMemo(
    () => ({
      role,
      categories,
      ownBrandDomain: ownBrand?.domain ?? null
    }),
    [role, categories, ownBrand]
  );

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Something went wrong. Please try again.");
        return false;
      }
      return true;
    } catch {
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function skip() {
    if (submitting) return;
    const ok = await post({ skipped: true, ...answerFields });
    if (ok) {
      setDone(true);
      router.refresh();
    }
  }

  async function complete() {
    if (submitting) return;
    const follows = picks
      .filter((pick) => pick.kind === "tracked")
      .map((pick) => pick.key);
    const requests = picks
      .filter(
        (pick): pick is Extract<OnboardingPick, { kind: "untracked" }> =>
          pick.kind === "untracked"
      )
      .map((pick) => ({ name: pick.brand.name, domain: pick.brand.domain }));
    const ok = await post({ ...answerFields, follows, requests });
    if (ok) {
      setDone(true);
      router.push("/explore");
      router.refresh();
    }
  }

  if (!visible) return null;

  const { title, subtitle } = STEP_TITLES[step];
  const pickCount = picks.length;
  const canContinue =
    step === 1
      ? role !== null
      : step === 2
        ? categories.length > 0
        : pickCount >= MIN_ONBOARDING_FOLLOWS &&
          pickCount <= MAX_ONBOARDING_FOLLOWS;

  function continueLabel(): string {
    if (step < 3) return "Continue";
    if (submitting) return "Setting up…";
    if (pickCount < MIN_ONBOARDING_FOLLOWS) {
      return `Follow at least ${MIN_ONBOARDING_FOLLOWS} brands`;
    }
    return `Follow ${pickCount} ${pickCount === 1 ? "brand" : "brands"}`;
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className={styles.modal}>
        <div className={styles.progressRow}>
          <span className={styles.progressLabel}>{step}/3</span>
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressFill}
              style={{ width: `${(step / 3) * 100}%` }}
            />
          </div>
        </div>
        <h2 id="onboarding-title" className={styles.title}>
          {title}
        </h2>
        <p className={styles.subtitle}>{subtitle}</p>

        <div className={styles.body}>
          {step === 1 ? (
            <OnboardingStepRole
              role={role}
              onRoleChange={setRole}
              ownBrand={ownBrand}
              onOwnBrandChange={setOwnBrand}
            />
          ) : null}
          {step === 2 ? (
            <OnboardingStepCategories
              markets={markets}
              selected={categories}
              onChange={setCategories}
            />
          ) : null}
          {step === 3 ? (
            <OnboardingStepFollow
              categories={categories}
              initialPopular={initialPopular}
              picks={picks}
              onChange={setPicks}
            />
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.skipLink}
            onClick={skip}
            disabled={submitting}
          >
            Skip for now
          </button>
          <div className={styles.footerRight}>
            {step === 3 ? (
              <span className={styles.pickCount}>
                {pickCount} of {MAX_ONBOARDING_FOLLOWS} picked
              </span>
            ) : null}
            {step > 1 ? (
              <button
                type="button"
                className={styles.back}
                onClick={() => setStep((current) => (current - 1) as 1 | 2)}
                disabled={submitting}
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              className={styles.primary}
              disabled={!canContinue || submitting}
              onClick={() => {
                if (step < 3) {
                  setStep((current) => (current + 1) as 2 | 3);
                } else {
                  void complete();
                }
              }}
            >
              {continueLabel()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
