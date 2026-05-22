"use client";

import { useMemo, useState } from "react";
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_LABELS,
  type EmailCategory
} from "@/lib/admin-types";
import type {
  CollectionRuleCombinator,
  CollectionRuleCondition,
  CollectionRuleField,
  CollectionRules
} from "@/lib/collections-db";
import type {
  ExploreBrandFacet,
  ExploreFacets
} from "@/lib/explore-db";
import styles from "./collections.module.css";

type Props = {
  /**
   * Existing rule (when editing) or `null` for the empty-state CTA
   * where we offer a fresh editor.
   */
  initialRules: CollectionRules | null;
  facets: ExploreFacets;
  /**
   * Persist handler. Throws / returns false → editor stays mounted and
   * surfaces the error. Resolves successfully → parent closes / swaps
   * to the read-only summary.
   */
  onSave: (rules: CollectionRules | null) => Promise<void> | void;
  onCancel?: () => void;
  /**
   * When true, the cancel button is shown — i.e. the editor is being
   * opened to edit an existing rule. The first-time empty-state CTA
   * hides cancel because there's nothing to revert to.
   */
  showCancel?: boolean;
};

type Draft = {
  combinator: CollectionRuleCombinator;
  conditions: CollectionRuleCondition[];
};

const FIELD_OPTIONS: { value: CollectionRuleField; label: string }[] = [
  { value: "search", label: "Search term" },
  { value: "category", label: "Category" },
  { value: "brand", label: "Brand" },
  { value: "market", label: "Market" },
  { value: "discount_percent", label: "Discount %" }
];

/**
 * Rule-based collection editor. Renders the saved query as a stack of
 * "field / operator / value" rows joined by a single combinator
 * (AND / OR) at the top — same model as a typical query builder.
 *
 * Validation is best-effort on the client (it disables the Save button
 * when any row is missing a value); the server re-validates on submit
 * and is the source of truth.
 */
export default function CollectionRulesEditor({
  initialRules,
  facets,
  onSave,
  onCancel,
  showCancel = false
}: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    initialRules
      ? {
          combinator: initialRules.combinator,
          conditions: initialRules.conditions.map((c) => ({ ...c }))
        }
      : {
          combinator: "AND",
          conditions: [makeBlankCondition("search")]
        }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedBrands = useMemo(
    () =>
      [...facets.brands].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    [facets.brands]
  );

  const isValid = useMemo(
    () => draft.conditions.length > 0 && draft.conditions.every(isComplete),
    [draft.conditions]
  );

  function updateCondition(
    index: number,
    next: CollectionRuleCondition
  ) {
    setDraft((current) => {
      const conditions = current.conditions.slice();
      conditions[index] = next;
      return { ...current, conditions };
    });
  }

  function changeField(index: number, field: CollectionRuleField) {
    setDraft((current) => {
      const existing = current.conditions[index];
      if (existing && existing.field === field) return current;
      const conditions = current.conditions.slice();
      conditions[index] = makeBlankCondition(field, existing?.id);
      return { ...current, conditions };
    });
  }

  function addCondition() {
    setDraft((current) => ({
      ...current,
      conditions: [...current.conditions, makeBlankCondition("search")]
    }));
  }

  function removeCondition(index: number) {
    setDraft((current) => {
      const conditions = current.conditions.slice();
      conditions.splice(index, 1);
      return { ...current, conditions };
    });
  }

  function setCombinator(combinator: CollectionRuleCombinator) {
    setDraft((current) => ({ ...current, combinator }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        version: 1,
        combinator: draft.combinator,
        conditions: draft.conditions
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rules");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.rulesEditor} onSubmit={handleSubmit}>
      <div className={styles.rulesEditorHeader}>
        <div>
          <h2 className={styles.rulesEditorTitle}>Automatic rules</h2>
          <p className={styles.rulesEditorSubtitle}>
            Add incoming emails to this collection if…
          </p>
        </div>
        <div className={styles.rulesCombinator}>
          <CombinatorOption
            value="AND"
            active={draft.combinator === "AND"}
            onClick={() => setCombinator("AND")}
            label="Match all"
            hint="AND"
          />
          <CombinatorOption
            value="OR"
            active={draft.combinator === "OR"}
            onClick={() => setCombinator("OR")}
            label="Match any"
            hint="OR"
          />
        </div>
      </div>

      <ul className={styles.rulesList}>
        {draft.conditions.map((condition, index) => (
          <li key={condition.id} className={styles.ruleRow}>
            {index > 0 ? (
              <span className={styles.ruleJoiner}>{draft.combinator}</span>
            ) : (
              <span className={styles.ruleJoinerPrefix}>If</span>
            )}

            <div className={styles.ruleControls}>
              <select
                className={styles.ruleSelect}
                value={condition.field}
                onChange={(event) =>
                  changeField(index, event.target.value as CollectionRuleField)
                }
                aria-label="Field"
              >
                {FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <ConditionValueInputs
                condition={condition}
                brands={sortedBrands}
                markets={facets.markets}
                onChange={(next) => updateCondition(index, next)}
              />
            </div>

            <button
              type="button"
              className={styles.ruleRemove}
              onClick={() => removeCondition(index)}
              disabled={draft.conditions.length === 1}
              aria-label="Remove condition"
              title="Remove condition"
            >
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={styles.ruleAddButton}
        onClick={addCondition}
      >
        <PlusIcon /> Add condition
      </button>

      {error ? (
        <div className={styles.rulesError} role="alert">
          {error}
        </div>
      ) : null}

      <div className={styles.rulesActions}>
        {showCancel && onCancel ? (
          <button
            type="button"
            className={styles.ruleCancelButton}
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          className={styles.ruleSaveButton}
          disabled={!isValid || saving}
        >
          {saving ? "Saving…" : initialRules ? "Save rules" : "Save and apply"}
        </button>
      </div>
    </form>
  );
}

function ConditionValueInputs({
  condition,
  brands,
  markets,
  onChange
}: {
  condition: CollectionRuleCondition;
  brands: ExploreBrandFacet[];
  markets: string[];
  onChange: (next: CollectionRuleCondition) => void;
}) {
  switch (condition.field) {
    case "search":
      return (
        <>
          <span className={styles.ruleOperator}>contains</span>
          <input
            type="text"
            value={condition.value}
            onChange={(event) =>
              onChange({ ...condition, value: event.target.value })
            }
            placeholder="e.g. black friday"
            maxLength={200}
            className={styles.ruleInput}
            aria-label="Search term"
          />
        </>
      );
    case "category":
      return (
        <>
          <span className={styles.ruleOperator}>is</span>
          <select
            className={styles.ruleSelect}
            value={condition.value}
            onChange={(event) =>
              onChange({
                ...condition,
                value: event.target.value as EmailCategory
              })
            }
            aria-label="Category"
          >
            <option value="">Choose a category…</option>
            {EMAIL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EMAIL_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </>
      );
    case "brand":
      return (
        <>
          <span className={styles.ruleOperator}>is</span>
          <select
            className={styles.ruleSelect}
            value={condition.value}
            onChange={(event) =>
              onChange({ ...condition, value: event.target.value })
            }
            aria-label="Brand"
          >
            <option value="">Choose a brand…</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </>
      );
    case "market":
      return (
        <>
          <span className={styles.ruleOperator}>is</span>
          <select
            className={styles.ruleSelect}
            value={condition.value}
            onChange={(event) =>
              onChange({ ...condition, value: event.target.value })
            }
            aria-label="Market"
          >
            <option value="">Choose a market…</option>
            {markets.map((market) => (
              <option key={market} value={market}>
                {market}
              </option>
            ))}
          </select>
        </>
      );
    case "discount_percent":
      return (
        <>
          <select
            className={styles.ruleOperator}
            value={condition.operator}
            onChange={(event) =>
              onChange({
                ...condition,
                operator: event.target.value as "gte" | "lte" | "eq"
              })
            }
            aria-label="Operator"
          >
            <option value="gte">is at least</option>
            <option value="lte">is at most</option>
            <option value="eq">equals</option>
          </select>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Number.isFinite(condition.value) ? condition.value : ""}
            onChange={(event) => {
              const next = event.target.value;
              onChange({
                ...condition,
                value: next === "" ? Number.NaN : Number(next)
              });
            }}
            className={styles.ruleNumberInput}
            aria-label="Discount percentage"
          />
          <span className={styles.ruleUnit}>%</span>
        </>
      );
  }
}

function CombinatorOption({
  value,
  active,
  onClick,
  label,
  hint
}: {
  value: CollectionRuleCombinator;
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${styles.combinatorOption} ${
        active ? styles.combinatorOptionActive : ""
      }`}
      title={`Match ${value === "AND" ? "all" : "any"} conditions`}
    >
      <span>{label}</span>
      <span className={styles.combinatorHint}>{hint}</span>
    </button>
  );
}

function makeBlankCondition(
  field: CollectionRuleField,
  preserveId?: string
): CollectionRuleCondition {
  const id = preserveId ?? `c-${Math.random().toString(36).slice(2, 10)}`;
  switch (field) {
    case "search":
      return { id, field: "search", operator: "contains", value: "" };
    case "category":
      return { id, field: "category", operator: "is", value: "sale" };
    case "brand":
      return { id, field: "brand", operator: "is", value: "" };
    case "market":
      return { id, field: "market", operator: "is", value: "" };
    case "discount_percent":
      return {
        id,
        field: "discount_percent",
        operator: "gte",
        value: 30
      };
  }
}

function isComplete(condition: CollectionRuleCondition): boolean {
  switch (condition.field) {
    case "search":
    case "market":
      return typeof condition.value === "string" && condition.value.trim().length > 0;
    case "brand":
      return typeof condition.value === "string" && condition.value.length > 0;
    case "category":
      return typeof condition.value === "string" && condition.value.length > 0;
    case "discount_percent":
      return (
        Number.isFinite(condition.value) &&
        condition.value >= 0 &&
        condition.value <= 100
      );
  }
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
