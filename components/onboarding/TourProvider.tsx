"use client";

import { driver, type Driver, type PopoverDOM } from "driver.js";
import "driver.js/dist/driver.css";
import "./tour-theme.css";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { TOUR_STEPS } from "./tour-steps";

/**
 * Cross-page onboarding tour controller.
 *
 * The tour walks a brand-new signup through the real app — /explore, /brands,
 * /following, /collections, /compare — spotlighting one element per stop with a
 * Back / Next / Skip tooltip (driver.js). Because the stops span several routes,
 * the controller lives in the root layout and persists its position in
 * `sessionStorage`, so it survives the client-side navigations between stops
 * (and a mid-tour refresh). When the user finishes or skips, it stamps
 * `tour_completed_at` (POST /api/complete-tour) and returns to /explore, where
 * the forced plan-choice modal then takes over.
 *
 * Idle cost is nil: with no active step the provider renders only its children
 * and never constructs a driver instance.
 */

const STORAGE_KEY = "pirol.tour.v1";
const VARIANT_KEY = "pirol.tour.v1.variant";
const ANCHOR_TIMEOUT_MS = 8000;

/**
 * Who the tour is running for. Default (null) is the brand-new signup flow,
 * where finishing hands over to the forced plan-choice modal — so the last
 * stop's button reads "Choose plan". A "member" run (invited team member,
 * seat already covered) has no plan step, so it just says "Finish".
 */
type TourVariant = "member" | null;

type TourContextValue = {
  /** Begin the tour from the first stop (no-op if already running). */
  start: (opts?: { variant?: "member" }) => void;
  active: boolean;
};

const TourContext = createContext<TourContextValue | null>(null);

/** Resolve once the selector matches an element, or null after `timeout`. */
function waitForElement(
  selector: string,
  timeout: number
): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (el: Element | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(el);
    };
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) finish(el);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => finish(null), timeout);
  });
}

export default function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // -1 = inactive; otherwise the current stop index. Mirrored into a ref so the
  // imperative driver.js click hooks always read the latest value without
  // re-binding the instance on every step.
  const [stepIndex, setStepIndex] = useState(-1);
  const stepRef = useRef(-1);
  useEffect(() => {
    stepRef.current = stepIndex;
  }, [stepIndex]);

  const driverRef = useRef<Driver | null>(null);
  // Late-bound click handlers, so the (single, long-lived) driver instance's
  // hooks always call the current closures.
  const handlersRef = useRef({
    next: () => {},
    prev: () => {},
    skip: () => {}
  });

  // Which flavour of tour is running (see TourVariant). Ref, not state: it's
  // only read inside the imperative highlight effect, and it never changes
  // mid-run.
  const variantRef = useRef<TourVariant>(null);

  const persist = useCallback((index: number) => {
    try {
      if (index < 0) {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(VARIANT_KEY);
      } else sessionStorage.setItem(STORAGE_KEY, String(index));
    } catch {
      // Private-mode / storage-disabled: the tour still works for this page
      // session, it just won't resume across a hard refresh.
    }
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(index);
      persist(index);
    },
    [persist]
  );

  // Tear down the driver overlay AND drop the reference. A destroyed driver
  // instance can't be reused, so the next highlight must build a fresh one.
  const destroyDriver = useCallback(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
  }, []);

  const endTour = useCallback(() => {
    setStepIndex(-1);
    persist(-1);
    destroyDriver();
  }, [persist, destroyDriver]);

  // Finish == skip: in both cases we mark the tour done so it never auto-starts
  // again, then return to /explore where the forced plan modal takes over.
  const finish = useCallback(() => {
    endTour();
    void fetch("/api/complete-tour", { method: "POST" }).catch(() => {});
    router.push("/explore");
    router.refresh();
  }, [endTour, router]);

  // Keep the click handlers current. Writing to the ref in an effect (not
  // during render) lets the long-lived driver instance's hooks always invoke
  // the latest closures over `finish` / `goTo`.
  useEffect(() => {
    handlersRef.current.next = () => {
      const i = stepRef.current;
      if (i + 1 >= TOUR_STEPS.length) finish();
      else goTo(i + 1);
    };
    handlersRef.current.prev = () => {
      const i = stepRef.current;
      if (i > 0) goTo(i - 1);
    };
    handlersRef.current.skip = () => finish();
  }, [finish, goTo]);

  const ensureDriver = useCallback((): Driver => {
    if (driverRef.current) return driverRef.current;
    driverRef.current = driver({
      allowClose: false, // Esc / overlay click don't end the tour — buttons do.
      // Informational tour: the spotlighted element stays inert, so a click on
      // (say) a brand card or nav row can't navigate the user out mid-tour.
      disableActiveInteraction: true,
      overlayColor: "#0b1220",
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 12,
      popoverClass: "pirol-tour",
      // Inject an explicit, always-visible "Skip tour" control into every
      // tooltip so the user can bail at any point.
      onPopoverRender: (popover: PopoverDOM) => {
        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "pirol-tour-skip";
        skip.textContent = "Skip tour";
        skip.addEventListener("click", () => handlersRef.current.skip());
        popover.footer.insertBefore(skip, popover.footer.firstChild);
      }
    });
    return driverRef.current;
  }, []);

  // Drive the highlight for the current stop. Re-runs whenever the step or the
  // route changes: if we're not yet on the stop's route we navigate and bail
  // (the pathname change re-triggers this effect on arrival), otherwise we wait
  // for the anchor to mount and spotlight it.
  useEffect(() => {
    if (stepIndex < 0) return;
    const step = TOUR_STEPS[stepIndex];
    if (!step) return;

    // Compare against the route's path only — a stop may carry a query string
    // (e.g. "/brands?q=ARKET" to surface the demo brand) that usePathname drops.
    const stepPath = step.route.split("?")[0];
    if (pathname !== stepPath) {
      // Forward click-through on an interactive stop: the user clicked the
      // spotlighted link, which navigated to the next stop's route. Advance to
      // it rather than yanking them back to this one.
      const next = TOUR_STEPS[stepIndex + 1];
      if (step.interactive && next && next.route.split("?")[0] === pathname) {
        goTo(stepIndex + 1);
        return;
      }
      router.push(step.route);
      return;
    }

    let cancelled = false;
    let modalObserver: MutationObserver | null = null;

    const isLast = stepIndex === TOUR_STEPS.length - 1;
    const showButtons: ("next" | "previous")[] =
      stepIndex === 0 ? ["next"] : ["previous", "next"];

    const popover = {
      title: step.title,
      description: `${step.body}<span class="pirol-tour-count">${
        stepIndex + 1
      } / ${TOUR_STEPS.length}</span>`,
      side: step.side ?? "bottom",
      align: step.align ?? "start",
      popoverClass: step.popoverClass,
      showButtons,
      nextBtnText: isLast
        ? variantRef.current === "member"
          ? "Finish"
          : "Choose plan"
        : "Next",
      prevBtnText: "Back",
      onNextClick: () => handlersRef.current.next(),
      onPrevClick: () => handlersRef.current.prev(),
      onCloseClick: () => handlersRef.current.skip()
    };

    const highlightStep = (el: Element) =>
      ensureDriver().highlight({
        element: el,
        // Interactive stops keep the spotlighted element clickable.
        disableActiveInteraction: !step.interactive,
        popover
      });

    // The email-preview modal renders BELOW driver's overlay, so while it's open
    // we tear the overlay down (revealing the preview) and on close we restore
    // this step's spotlight. We deliberately do NOT auto-advance — the user
    // stays on this stop and moves on with Next, so closing the preview never
    // surprises them by jumping to the next section.
    const watchEmailModal = (el: Element) => {
      let open = false;
      const isModalOpen = () =>
        Array.from(
          document.querySelectorAll('[role="dialog"][aria-modal="true"]')
        ).some((node) => !node.closest(".driver-popover"));
      modalObserver = new MutationObserver(() => {
        const nowOpen = isModalOpen();
        if (nowOpen && !open) {
          open = true;
          destroyDriver();
        } else if (!nowOpen && open) {
          open = false;
          highlightStep(el);
        }
      });
      modalObserver.observe(document.body, { childList: true, subtree: true });
    };

    if (step.scrollTop) window.scrollTo({ top: 0 });

    // Centered welcome stop: no anchor, no spotlight — just a popover.
    if (!step.anchor) {
      ensureDriver().highlight({ popover });
      return () => {
        cancelled = true;
      };
    }

    waitForElement(step.anchor, ANCHOR_TIMEOUT_MS).then((el) => {
      if (cancelled) return;
      if (!el) {
        // Anchor never showed (slow page / markup drift). Don't trap the user
        // on a blank overlay — advance past this stop.
        handlersRef.current.next();
        return;
      }

      highlightStep(el);

      if (step.advance === "email-modal") watchEmailModal(el);
    });

    return () => {
      cancelled = true;
      modalObserver?.disconnect();
    };
  }, [stepIndex, pathname, ensureDriver, destroyDriver, goTo, router]);

  // Resume an in-progress tour after a hard refresh (the step was persisted).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0 && n < TOUR_STEPS.length) {
        variantRef.current =
          sessionStorage.getItem(VARIANT_KEY) === "member" ? "member" : null;
        // Mount-time read of persisted state; can't be a lazy initializer
        // because sessionStorage isn't available during SSR.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStepIndex(n);
      }
    } catch {
      // ignore — nothing to resume
    }
  }, []);

  // Tear down the driver instance if the provider ever unmounts.
  useEffect(() => () => destroyDriver(), [destroyDriver]);

  const start = useCallback(
    (opts?: { variant?: "member" }) => {
      if (stepRef.current >= 0) return;
      try {
        // Already mid-tour (resuming from storage) — don't restart from 0.
        if (sessionStorage.getItem(STORAGE_KEY) !== null) return;
      } catch {
        // ignore
      }
      variantRef.current = opts?.variant ?? null;
      try {
        if (opts?.variant) sessionStorage.setItem(VARIANT_KEY, opts.variant);
        else sessionStorage.removeItem(VARIANT_KEY);
      } catch {
        // ignore — the variant just won't survive a hard refresh
      }
      goTo(0);
    },
    [goTo]
  );

  const value = useMemo<TourContextValue>(
    () => ({ start, active: stepIndex >= 0 }),
    [start, stepIndex]
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

/** Opener/state for the onboarding tour, or null outside the provider. */
export function useTour(): TourContextValue | null {
  return useContext(TourContext);
}
