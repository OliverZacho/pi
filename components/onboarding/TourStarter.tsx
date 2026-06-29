"use client";

import { useEffect } from "react";
import { useTour } from "./TourProvider";

/**
 * Auto-starts the onboarding tour on mount. Rendered server-side on /explore
 * only for a brand-new signup who hasn't yet finished the tour or picked a plan
 * (see app/explore/page.tsx). The actual tour state + cross-page driving lives
 * in {@link TourProvider}; this is just the trigger. `start()` no-ops if a tour
 * is already running or being resumed from storage, so a refresh mid-tour won't
 * restart it from the first stop.
 */
export default function TourStarter() {
  const tour = useTour();

  useEffect(() => {
    tour?.start();
  }, [tour]);

  return null;
}
