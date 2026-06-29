"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import PlanChoiceModal from "./PlanChoiceModal";

type UpgradeModalContextValue = {
  /** Open the on-demand plan picker (the dismissible upgrade variant). */
  open: () => void;
};

const UpgradeModalContext = createContext<UpgradeModalContextValue | null>(null);

/**
 * Mounts a single, app-wide plan picker that any upgrade CTA can open on demand
 * (see {@link useUpgradeModal} and `TrackedUpgradeLink`). This is the dismissible
 * "upgrade" variant of {@link PlanChoiceModal} — distinct from the forced
 * onboarding modal rendered server-side on /explore for brand-new signups.
 *
 * The modal is only rendered while open, so the provider is cheap to keep at the
 * root of the tree.
 */
export default function UpgradeModalProvider({
  children
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const value = useMemo<UpgradeModalContextValue>(
    () => ({ open: () => setOpen(true) }),
    []
  );

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <UpgradeModalContext.Provider value={value}>
      {children}
      {open ? <PlanChoiceModal onClose={handleClose} /> : null}
    </UpgradeModalContext.Provider>
  );
}

/**
 * Returns the opener for the app-wide upgrade modal, or `null` when no provider
 * is mounted (e.g. logged-out marketing pages) so callers can fall back to a
 * plain `/pricing` navigation.
 */
export function useUpgradeModal(): UpgradeModalContextValue | null {
  return useContext(UpgradeModalContext);
}
