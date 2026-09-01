"use client";

import { formatMarketLabel } from "@/lib/market-label";
import styles from "./onboarding.module.css";

type Props = {
  /** Raw market slugs currently in use across tracked brands. */
  markets: string[];
  /** Selected raw slugs (the canonical value; labels are display-only). */
  selected: string[];
  onChange: (next: string[]) => void;
};

/**
 * Step 2: multi-select category chips built from the live `companies.markets`
 * facet list. Raw slugs stay the stored value; `formatMarketLabel` handles
 * display. At least one pick is required to continue (the step-3 suggestion
 * grid is seeded from these), with the modal's skip link as the escape hatch.
 */
export default function OnboardingStepCategories({
  markets,
  selected,
  onChange
}: Props) {
  function toggle(market: string) {
    if (selected.includes(market)) {
      onChange(selected.filter((value) => value !== market));
    } else {
      onChange([...selected, market]);
    }
  }

  return (
    <div className={styles.chipWrap} role="group" aria-label="Categories">
      {markets.map((market) => {
        const active = selected.includes(market);
        return (
          <button
            key={market}
            type="button"
            aria-pressed={active}
            className={[styles.chip, active ? styles.chipActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => toggle(market)}
          >
            {formatMarketLabel(market)}
          </button>
        );
      })}
    </div>
  );
}
