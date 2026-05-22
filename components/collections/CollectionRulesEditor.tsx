"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
          <span className={styles.ruleOperator}>is any of</span>
          <MultiSelect
            ariaLabel="Categories"
            placeholder="Choose categories…"
            options={EMAIL_CATEGORIES.map((category) => ({
              value: category,
              label: EMAIL_CATEGORY_LABELS[category]
            }))}
            values={condition.values}
            onChange={(values) =>
              onChange({
                ...condition,
                values: values as EmailCategory[]
              })
            }
          />
        </>
      );
    case "brand":
      return (
        <>
          <span className={styles.ruleOperator}>is any of</span>
          <MultiSelect
            ariaLabel="Brands"
            placeholder="Choose brands…"
            searchable
            options={brands.map((brand) => ({
              value: brand.id,
              label: brand.name
            }))}
            values={condition.values}
            onChange={(values) => onChange({ ...condition, values })}
          />
        </>
      );
    case "market":
      return (
        <>
          <span className={styles.ruleOperator}>is any of</span>
          <MultiSelect
            ariaLabel="Markets"
            placeholder="Choose markets…"
            options={markets.map((market) => ({
              value: market,
              label: market
            }))}
            values={condition.values}
            onChange={(values) => onChange({ ...condition, values })}
          />
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
      return { id, field: "category", operator: "in", values: [] };
    case "brand":
      return { id, field: "brand", operator: "in", values: [] };
    case "market":
      return { id, field: "market", operator: "in", values: [] };
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
      return condition.value.trim().length > 0;
    case "brand":
    case "category":
    case "market":
      return condition.values.length > 0;
    case "discount_percent":
      return (
        Number.isFinite(condition.value) &&
        condition.value >= 0 &&
        condition.value <= 100
      );
  }
}

type MultiSelectOption = { value: string; label: string };

/**
 * Compact multi-select dropdown that matches the editor's chip-style
 * aesthetic. The trigger is the same height as the neighbouring
 * `select`s, displays the selected count, and opens a popover with a
 * (optionally searchable) checkbox list. We don't use native
 * `<select multiple>` because it renders as a stacked listbox that
 * breaks the inline-row layout and is awkward on touch devices.
 */
function MultiSelect({
  ariaLabel,
  placeholder,
  options,
  values,
  onChange,
  searchable = false
}: {
  ariaLabel: string;
  placeholder: string;
  options: MultiSelectOption[];
  values: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleDown(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    if (searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, searchable]);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(q)
    );
  }, [options, query]);

  // Surface the selected-but-now-filtered-out options at the top of
  // the list so users can always uncheck them, even if their search
  // query hides them from the main list.
  const visible = useMemo(() => {
    if (!query) return filtered;
    const filteredValues = new Set(filtered.map((o) => o.value));
    const pinned = options.filter(
      (option) =>
        selectedSet.has(option.value) && !filteredValues.has(option.value)
    );
    return [...pinned, ...filtered];
  }, [filtered, options, query, selectedSet]);

  const triggerLabel = (() => {
    if (values.length === 0) return placeholder;
    if (values.length === 1) {
      const match = options.find((o) => o.value === values[0]);
      return match?.label ?? values[0];
    }
    return `${values.length} selected`;
  })();

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div className={styles.multiSelect} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.multiSelectTrigger} ${
          values.length === 0 ? styles.multiSelectTriggerEmpty : ""
        } ${open ? styles.multiSelectTriggerOpen : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={styles.multiSelectLabel}>{triggerLabel}</span>
        <span className={styles.multiSelectCaret} aria-hidden="true">
          <CaretIcon />
        </span>
      </button>

      {open ? (
        <div className={styles.multiSelectPopover} role="listbox">
          {searchable ? (
            <div className={styles.multiSelectSearch}>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${ariaLabel.toLowerCase()}`}
                className={styles.multiSelectSearchInput}
                aria-label={`Search ${ariaLabel}`}
              />
            </div>
          ) : null}
          <ul className={styles.multiSelectList}>
            {visible.length === 0 ? (
              <li className={styles.multiSelectEmpty}>No matches</li>
            ) : (
              visible.map((option) => {
                const checked = selectedSet.has(option.value);
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={`${styles.multiSelectOption} ${
                        checked ? styles.multiSelectOptionChecked : ""
                      }`}
                      onClick={() => toggle(option.value)}
                      role="option"
                      aria-selected={checked}
                    >
                      <span
                        className={`${styles.multiSelectCheckbox} ${
                          checked ? styles.multiSelectCheckboxChecked : ""
                        }`}
                        aria-hidden="true"
                      >
                        {checked ? <CheckIcon /> : null}
                      </span>
                      <span className={styles.multiSelectOptionLabel}>
                        {option.label}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {values.length > 0 ? (
            <div className={styles.multiSelectFooter}>
              <button
                type="button"
                className={styles.multiSelectClear}
                onClick={clearAll}
              >
                Clear selection
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CaretIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
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
