"use client";

import {
  ONBOARDING_ROLES,
  ONBOARDING_ROLE_LABELS,
  ROLES_WITH_OWN_BRAND,
  type OnboardingRole
} from "@/lib/onboarding";
import OnboardingBrandSearch from "./OnboardingBrandSearch";
import type { OwnBrandAnswer } from "./OnboardingModal";
import styles from "./onboarding.module.css";

type Props = {
  role: OnboardingRole | null;
  onRoleChange: (role: OnboardingRole) => void;
  ownBrand: OwnBrandAnswer | null;
  onOwnBrandChange: (value: OwnBrandAnswer | null) => void;
};

/**
 * Step 1: "What brings you to Pirol?" — single-select role cards. Picking
 * a professional role (brand marketer / founder) reveals an optional
 * "Which brand do you work on?" typeahead whose answer powers /your-brand
 * matching for accounts that signed up with a personal email address.
 */
export default function OnboardingStepRole({
  role,
  onRoleChange,
  ownBrand,
  onOwnBrandChange
}: Props) {
  const showOwnBrand = role !== null && ROLES_WITH_OWN_BRAND.includes(role);

  return (
    <div>
      <div className={styles.roleGrid} role="radiogroup" aria-label="What brings you to Pirol?">
        {ONBOARDING_ROLES.map((value) => {
          const active = role === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              className={[styles.roleCard, active ? styles.roleCardActive : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onRoleChange(value)}
            >
              <span className={styles.roleDot} aria-hidden="true" />
              {ONBOARDING_ROLE_LABELS[value]}
            </button>
          );
        })}
      </div>

      {showOwnBrand ? (
        <div className={styles.ownBrandWrap}>
          <span className={styles.ownBrandLabel}>
            Which brand do you work on?
          </span>
          <p className={styles.ownBrandHint}>
            Optional. It unlocks insights about your own email program.
          </p>
          {ownBrand ? (
            <span className={styles.ownBrandPicked}>
              {ownBrand.name}
              <button
                type="button"
                className={styles.ownBrandClear}
                onClick={() => onOwnBrandChange(null)}
                aria-label={`Remove ${ownBrand.name}`}
              >
                ×
              </button>
            </span>
          ) : (
            <OnboardingBrandSearch
              placeholder="Search for your brand…"
              selectedKeys={new Set()}
              closeOnPick
              onPickTracked={(brand) =>
                onOwnBrandChange({ name: brand.name, domain: brand.domain })
              }
              onPickUntracked={(brand) =>
                onOwnBrandChange({ name: brand.name, domain: brand.domain })
              }
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
