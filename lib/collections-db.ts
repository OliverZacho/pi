import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_CATEGORIES, type EmailCategory } from "./admin-types";
import {
  safeParseEventDetection,
  type CollectionEventDetection
} from "./collection-event-shared";
import { type CollectionIcon, isCollectionIcon } from "./collection-icons";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import { collapseDuplicateRows } from "./dedup";
import type { Database, Json } from "@/types/supabase";
import type { ExploreEmailCard } from "./explore-db";

/**
 * Helpers for the user-owned Collections feature.
 *
 * Collections are like Pinterest boards: an admin user groups
 * `captured_emails` rows under a named bucket, and every collection is
 * publicly readable via its `share_slug` (`/c/<slug>`) so anyone with the
 * link can view it without an account.
 *
 * The helpers split along that axis:
 *  - The user-bound `SupabaseClient` (from `createClient`) is used for
 *    owner reads / writes. RLS scopes operations to `auth.uid()` and the
 *    `admin_users` table.
 *  - The service-role admin client (from `getSupabaseAdmin`) is used to
 *    serve public share URLs because the visitor may be anonymous.
 */

const SLUG_BYTES = 12;
const MAX_NAME_LENGTH = 120;
const PREVIEW_EMAIL_COUNT = 4;

const MAX_RULE_CONDITIONS = 12;
const MAX_RULE_VALUE_LENGTH = 200;
const RULE_EVAL_LIMIT = 200;
// Discount rows pulled for the 12-month per-brand benchmark. Only emails
// with a parsed discount from the collection's brands count, so this is a
// generous ceiling rather than an expected volume.
const BENCHMARK_ROW_LIMIT = 5000;

// ---------- Rule schema ----------
//
// A "rule-based" collection auto-populates from a saved query. The shape
// is intentionally narrow: a combinator (AND / OR) plus a flat list of
// per-field conditions. Nested groups would be a natural next step but
// the dropdowns the product spec calls for don't need them yet, and
// keeping the schema flat means the evaluator can compile straight to a
// single PostgREST query.

export const COLLECTION_RULE_FIELDS = [
  "search",
  "category",
  "brand",
  "market",
  "country",
  "discount_percent"
] as const;

export type CollectionRuleField = (typeof COLLECTION_RULE_FIELDS)[number];

export type CollectionRuleCondition =
  | {
      id: string;
      field: "search";
      operator: "contains";
      value: string;
    }
  | {
      id: string;
      field: "category";
      operator: "in";
      values: EmailCategory[];
    }
  | {
      id: string;
      field: "brand";
      operator: "in";
      /** companies.id (uuid)[] */
      values: string[];
    }
  | {
      id: string;
      field: "market";
      operator: "in";
      /** Tags to overlap-match against `companies.markets`. */
      values: string[];
    }
  | {
      id: string;
      field: "country";
      operator: "in";
      /** ISO 3166-1 alpha-2 codes matched against `captured_emails.detected_country`. */
      values: string[];
    }
  | {
      id: string;
      field: "discount_percent";
      operator: "gte" | "lte" | "eq";
      value: number;
    };

export type CollectionRuleCombinator = "AND" | "OR";

/**
 * Time-window scope:
 *
 *  - `all`     → match every email regardless of when it arrived
 *                (the original "passive collection" behaviour).
 *  - `future`  → only emails received at-or-after `appliedAt`
 *                ("from now on, collect new matching emails").
 *  - `past`    → only emails received strictly before `appliedAt`
 *                ("snapshot what already exists; ignore new arrivals").
 *
 * `appliedAt` is the timestamp anchor for `future` / `past`. It's
 * always `null` when scope is `all`. The API layer sets / preserves it
 * — see `resolveAppliedAt`.
 */
export const COLLECTION_RULE_SCOPES = ["all", "future", "past"] as const;
export type CollectionRuleScope = (typeof COLLECTION_RULE_SCOPES)[number];

/**
 * Optional time window that constrains which emails the rule matches by
 * `received_at` — independent of, and AND'd with, both the `scope`
 * anchor and the per-condition combinator. Two shapes:
 *
 *  - `rolling` → a window that always trails "now", e.g. "the last 30
 *    days". Re-evaluated on every query, so emails age out of the
 *    collection as they fall past the window.
 *  - `range`   → a fixed window between two calendar dates (inclusive).
 *    `from` / `to` are `YYYY-MM-DD` strings; at least one is set and a
 *    `null` end means "open-ended" on that side.
 *
 * `null` (the default) means "any time".
 */
export const COLLECTION_RULE_WINDOW_UNITS = ["days", "weeks", "months"] as const;
export type CollectionRuleWindowUnit =
  (typeof COLLECTION_RULE_WINDOW_UNITS)[number];

export type CollectionRuleTimeWindow =
  | { type: "rolling"; amount: number; unit: CollectionRuleWindowUnit }
  | { type: "range"; from: string | null; to: string | null };

export type CollectionRules = {
  version: 1;
  combinator: CollectionRuleCombinator;
  conditions: CollectionRuleCondition[];
  scope: CollectionRuleScope;
  /** ISO timestamp; required when `scope !== "all"`, otherwise `null`. */
  appliedAt: string | null;
  /** Optional `received_at` window; `null` means "any time". */
  timeWindow: CollectionRuleTimeWindow | null;
};

const MAX_ROLLING_WINDOW_AMOUNT = 3650;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CATEGORY_LOOKUP = new Set<string>(EMAIL_CATEGORIES);

export class CollectionRulesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionRulesValidationError";
  }
}

export class CollectionIconValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionIconValidationError";
  }
}

/**
 * Extracts the list of selected values from an incoming condition,
 * accepting both the new `values: T[]` shape and the legacy
 * `value: T` shape (single selection) so older rows already stored
 * in the database keep parsing.
 */
function collectMultiValue(cond: Record<string, unknown>): unknown[] {
  if (Array.isArray(cond.values)) return cond.values;
  if (Object.prototype.hasOwnProperty.call(cond, "value")) {
    if (Array.isArray(cond.value)) return cond.value;
    if (cond.value !== undefined && cond.value !== null) return [cond.value];
  }
  return [];
}

/**
 * Coerce an arbitrary JSON payload (e.g. from the request body or
 * straight off the database) into a strongly-typed `CollectionRules`
 * value, throwing `CollectionRulesValidationError` on anything that
 * can't be coerced. Returns `null` for explicit `null` / `undefined`
 * inputs so the same helper can be used to read the DB column (where
 * `null` means "manual collection") and to validate API input (where
 * `null` is how the client signals "clear the rules").
 */
export function parseCollectionRules(input: unknown): CollectionRules | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new CollectionRulesValidationError("rules must be an object");
  }
  const raw = input as Record<string, unknown>;

  const combinator = raw.combinator;
  if (combinator !== "AND" && combinator !== "OR") {
    throw new CollectionRulesValidationError(
      'rules.combinator must be "AND" or "OR"'
    );
  }

  const conditionsRaw = raw.conditions;
  if (!Array.isArray(conditionsRaw)) {
    throw new CollectionRulesValidationError(
      "rules.conditions must be an array"
    );
  }
  if (conditionsRaw.length > MAX_RULE_CONDITIONS) {
    throw new CollectionRulesValidationError(
      `rules.conditions may not exceed ${MAX_RULE_CONDITIONS} entries`
    );
  }

  const conditions: CollectionRuleCondition[] = [];
  for (const [index, c] of conditionsRaw.entries()) {
    conditions.push(parseCondition(c, index));
  }

  // Scope defaults to "all" so rule rows that predate this column keep
  // working unchanged.
  const scopeRaw = raw.scope;
  let scope: CollectionRuleScope = "all";
  if (scopeRaw !== undefined && scopeRaw !== null) {
    if (
      typeof scopeRaw !== "string" ||
      !(COLLECTION_RULE_SCOPES as readonly string[]).includes(scopeRaw)
    ) {
      throw new CollectionRulesValidationError(
        'rules.scope must be "all", "future" or "past"'
      );
    }
    scope = scopeRaw as CollectionRuleScope;
  }

  // `appliedAt` is server-managed but we accept what the caller sends
  // so we can validate it. The API layer overrides the final value
  // before persistence.
  let appliedAt: string | null = null;
  if (raw.appliedAt !== undefined && raw.appliedAt !== null) {
    if (typeof raw.appliedAt !== "string") {
      throw new CollectionRulesValidationError(
        "rules.appliedAt must be an ISO timestamp string"
      );
    }
    const parsed = Date.parse(raw.appliedAt);
    if (!Number.isFinite(parsed)) {
      throw new CollectionRulesValidationError(
        "rules.appliedAt is not a parseable timestamp"
      );
    }
    appliedAt = new Date(parsed).toISOString();
  }

  // Scope=all and appliedAt are mutually exclusive — normalise here so
  // the rest of the code can rely on the invariant.
  if (scope === "all") {
    appliedAt = null;
  }

  const timeWindow = parseTimeWindow(raw.timeWindow);

  return {
    version: 1,
    combinator,
    conditions,
    scope,
    appliedAt,
    timeWindow
  };
}

/**
 * Coerce the optional `received_at` window. Returns `null` for
 * missing / explicit-null input so rule rows that predate this field
 * keep parsing as "any time".
 */
function parseTimeWindow(input: unknown): CollectionRuleTimeWindow | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new CollectionRulesValidationError(
      "rules.timeWindow must be an object"
    );
  }
  const raw = input as Record<string, unknown>;

  if (raw.type === "rolling") {
    const amount = raw.amount;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > MAX_ROLLING_WINDOW_AMOUNT
    ) {
      throw new CollectionRulesValidationError(
        `rules.timeWindow.amount must be a whole number between 1 and ${MAX_ROLLING_WINDOW_AMOUNT}`
      );
    }
    const unit = raw.unit;
    if (
      typeof unit !== "string" ||
      !(COLLECTION_RULE_WINDOW_UNITS as readonly string[]).includes(unit)
    ) {
      throw new CollectionRulesValidationError(
        'rules.timeWindow.unit must be "days", "weeks" or "months"'
      );
    }
    return { type: "rolling", amount, unit: unit as CollectionRuleWindowUnit };
  }

  if (raw.type === "range") {
    const from = parseWindowDate(raw.from, "from");
    const to = parseWindowDate(raw.to, "to");
    if (!from && !to) {
      throw new CollectionRulesValidationError(
        "rules.timeWindow needs at least a from or to date"
      );
    }
    // Both are normalised to `YYYY-MM-DD`, so a lexical compare is a
    // chronological one.
    if (from && to && from > to) {
      throw new CollectionRulesValidationError(
        "rules.timeWindow.from must be on or before rules.timeWindow.to"
      );
    }
    return { type: "range", from, to };
  }

  throw new CollectionRulesValidationError(
    'rules.timeWindow.type must be "rolling" or "range"'
  );
}

function parseWindowDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new CollectionRulesValidationError(
      `rules.timeWindow.${label} must be a YYYY-MM-DD date string`
    );
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new CollectionRulesValidationError(
      `rules.timeWindow.${label} must be a YYYY-MM-DD date`
    );
  }
  if (!Number.isFinite(Date.parse(`${trimmed}T00:00:00.000Z`))) {
    throw new CollectionRulesValidationError(
      `rules.timeWindow.${label} is not a valid date`
    );
  }
  return trimmed;
}

/**
 * Resolve a time window into concrete `received_at` bounds. For
 * `rolling` the lower bound is computed against "now" at call time, so
 * the window genuinely trails the present on every evaluation.
 */
function timeWindowBounds(
  window: CollectionRuleTimeWindow | null
): { gte?: string; lte?: string } {
  if (!window) return {};
  if (window.type === "rolling") {
    const cutoff = new Date();
    if (window.unit === "months") {
      cutoff.setMonth(cutoff.getMonth() - window.amount);
    } else if (window.unit === "weeks") {
      cutoff.setDate(cutoff.getDate() - window.amount * 7);
    } else {
      cutoff.setDate(cutoff.getDate() - window.amount);
    }
    return { gte: cutoff.toISOString() };
  }
  const bounds: { gte?: string; lte?: string } = {};
  if (window.from) bounds.gte = `${window.from}T00:00:00.000Z`;
  // `to` is inclusive of the whole calendar day.
  if (window.to) bounds.lte = `${window.to}T23:59:59.999Z`;
  return bounds;
}

/**
 * Decide what `appliedAt` the next persisted version of the rule
 * should carry. The policy is:
 *
 *  - scope=all → always `null`.
 *  - scope changed (or rule is brand new) → "now".
 *  - scope unchanged and the existing rule already had an anchor →
 *    preserve it, so editing unrelated parts of the rule (e.g.
 *    adding a brand) doesn't silently reset the cutoff.
 */
export function resolveAppliedAt(
  existing: CollectionRules | null,
  incomingScope: CollectionRuleScope
): string | null {
  if (incomingScope === "all") return null;
  if (
    existing &&
    existing.scope === incomingScope &&
    existing.appliedAt
  ) {
    return existing.appliedAt;
  }
  return new Date().toISOString();
}

function parseCondition(
  raw: unknown,
  index: number
): CollectionRuleCondition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CollectionRulesValidationError(
      `rules.conditions[${index}] must be an object`
    );
  }
  const cond = raw as Record<string, unknown>;
  const id =
    typeof cond.id === "string" && cond.id.length > 0
      ? cond.id
      : `c-${index}-${Math.random().toString(36).slice(2, 8)}`;
  const field = cond.field;
  if (typeof field !== "string") {
    throw new CollectionRulesValidationError(
      `rules.conditions[${index}].field is required`
    );
  }
  switch (field) {
    case "search": {
      if (cond.operator !== "contains") {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (search) operator must be "contains"`
        );
      }
      const value = typeof cond.value === "string" ? cond.value.trim() : "";
      if (value.length === 0) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (search) value cannot be empty`
        );
      }
      if (value.length > MAX_RULE_VALUE_LENGTH) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (search) value is too long`
        );
      }
      return { id, field: "search", operator: "contains", value };
    }
    case "category": {
      if (cond.operator !== "in" && cond.operator !== "is") {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (category) operator must be "in"`
        );
      }
      const raw = collectMultiValue(cond);
      const values: EmailCategory[] = [];
      for (const candidate of raw) {
        if (typeof candidate !== "string" || !CATEGORY_LOOKUP.has(candidate)) {
          throw new CollectionRulesValidationError(
            `rules.conditions[${index}] (category) value "${String(candidate)}" is not a known category`
          );
        }
        if (!values.includes(candidate as EmailCategory)) {
          values.push(candidate as EmailCategory);
        }
      }
      if (values.length === 0) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (category) must select at least one value`
        );
      }
      return { id, field: "category", operator: "in", values };
    }
    case "brand": {
      if (cond.operator !== "in" && cond.operator !== "is") {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (brand) operator must be "in"`
        );
      }
      const raw = collectMultiValue(cond);
      const values: string[] = [];
      for (const candidate of raw) {
        if (typeof candidate !== "string" || !UUID_PATTERN.test(candidate)) {
          throw new CollectionRulesValidationError(
            `rules.conditions[${index}] (brand) values must be company ids`
          );
        }
        if (!values.includes(candidate)) values.push(candidate);
      }
      if (values.length === 0) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (brand) must select at least one value`
        );
      }
      return { id, field: "brand", operator: "in", values };
    }
    case "market": {
      if (cond.operator !== "in" && cond.operator !== "is") {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (market) operator must be "in"`
        );
      }
      const raw = collectMultiValue(cond);
      const values: string[] = [];
      for (const candidate of raw) {
        if (typeof candidate !== "string") {
          throw new CollectionRulesValidationError(
            `rules.conditions[${index}] (market) values must be strings`
          );
        }
        const trimmed = candidate.trim();
        if (trimmed.length === 0) continue;
        if (trimmed.length > MAX_RULE_VALUE_LENGTH) {
          throw new CollectionRulesValidationError(
            `rules.conditions[${index}] (market) value is too long`
          );
        }
        if (!values.includes(trimmed)) values.push(trimmed);
      }
      if (values.length === 0) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (market) must select at least one value`
        );
      }
      return { id, field: "market", operator: "in", values };
    }
    case "country": {
      if (cond.operator !== "in" && cond.operator !== "is") {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (country) operator must be "in"`
        );
      }
      const raw = collectMultiValue(cond);
      const values: string[] = [];
      for (const candidate of raw) {
        if (typeof candidate !== "string" || !/^[A-Za-z]{2}$/.test(candidate)) {
          throw new CollectionRulesValidationError(
            `rules.conditions[${index}] (country) values must be ISO alpha-2 country codes`
          );
        }
        const code = candidate.toUpperCase();
        if (!values.includes(code)) values.push(code);
      }
      if (values.length === 0) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (country) must select at least one value`
        );
      }
      return { id, field: "country", operator: "in", values };
    }
    case "discount_percent": {
      if (
        cond.operator !== "gte" &&
        cond.operator !== "lte" &&
        cond.operator !== "eq"
      ) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (discount_percent) operator must be gte/lte/eq`
        );
      }
      const numeric =
        typeof cond.value === "number"
          ? cond.value
          : typeof cond.value === "string" && cond.value.trim().length > 0
            ? Number(cond.value)
            : NaN;
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        throw new CollectionRulesValidationError(
          `rules.conditions[${index}] (discount_percent) value must be a number between 0 and 100`
        );
      }
      return {
        id,
        field: "discount_percent",
        operator: cond.operator,
        value: Math.round(numeric)
      };
    }
    default:
      throw new CollectionRulesValidationError(
        `rules.conditions[${index}].field "${field}" is not supported`
      );
  }
}

/**
 * Shared shape for the grid card on `/collections`: enough to render
 * the 2x2 mosaic + title + share link without a second round-trip.
 */
export type CollectionCardData = {
  id: string;
  name: string;
  /** Curated emoji icon, or `null` to fall back to the generic glyph. */
  icon: CollectionIcon | null;
  shareSlug: string;
  emailCount: number;
  previewEmailIds: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Minimal shape used by the sidebar / "Add to collection" popover.
 * Skips the preview ids + counts so the payload stays cheap to send on
 * every page load.
 */
export type CollectionSummary = {
  id: string;
  name: string;
  /** Curated emoji icon, or `null` to fall back to the generic glyph. */
  icon: CollectionIcon | null;
  shareSlug: string;
  /**
   * True when the collection has automatic rules and at least one
   * matching email arrived after the owner last opened the collection.
   */
  hasNewEmails?: boolean;
  /**
   * True when the row belongs to a teammate who shared it with the
   * team (read-only for the viewer). The sidebar marks these rows with
   * a small team badge.
   */
  sharedByTeam?: boolean;
  /** Display name of the teammate who owns the shared row, if resolved. */
  teamOwnerName?: string | null;
};

export type CollectionDetail = {
  id: string;
  name: string;
  /** Curated emoji icon, or `null` to fall back to the generic glyph. */
  icon: CollectionIcon | null;
  shareSlug: string;
  ownerId: string;
  /** Owner has shared this with their team (read-only for co-members). */
  sharedWithTeam: boolean;
  /** Owner opted in to email alerts when new emails match the rules. */
  notifyNewMatches: boolean;
  emailCount: number;
  createdAt: string;
  updatedAt: string;
  emails: ExploreEmailCard[];
  /**
   * Saved rule definition, or `null` for a manually-curated collection.
   * When non-null, `emails` is computed from the rule rather than from
   * the `collection_emails` membership table.
   */
  rules: CollectionRules | null;
  /**
   * Cached LLM event detection, or `null` when the collection has never
   * qualified for (or completed) a detection run.
   */
  eventDetection: CollectionEventDetection | null;
};

/**
 * Returns every collection the user owns, ordered most-recently-updated
 * first (matches the sidebar's expected ordering). Each row carries up
 * to four newest email ids so the grid card can render a 2x2 preview
 * without a second join.
 */
export async function listCollectionsWithPreviews(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CollectionCardData[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, icon, share_slug, created_at, updated_at, rules")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Split the rows into the two membership modes up-front. Manual
  // collections share a single batched lookup against
  // `collection_emails`; rule-based ones each get their own evaluator
  // call (one per collection — small N, dominant cost is already the
  // emails query itself).
  const manualRows: typeof rows = [];
  const ruleRows: { row: (typeof rows)[number]; rules: CollectionRules }[] = [];
  for (const row of rows) {
    const parsed = safeParseStoredRules(row.rules);
    if (parsed) ruleRows.push({ row, rules: parsed });
    else manualRows.push(row);
  }

  const counts = new Map<string, number>();
  const previews = new Map<string, string[]>();

  if (manualRows.length > 0) {
    const manualIds = manualRows.map((row) => row.id);
    const { data: memberRows, error: memberError } = await supabase
      .from("collection_emails")
      .select("collection_id, email_id, added_at")
      .in("collection_id", manualIds)
      .order("added_at", { ascending: false });

    if (memberError) throw memberError;

    for (const row of memberRows ?? []) {
      counts.set(row.collection_id, (counts.get(row.collection_id) ?? 0) + 1);
      const bucket = previews.get(row.collection_id) ?? [];
      if (bucket.length < PREVIEW_EMAIL_COUNT) {
        bucket.push(row.email_id);
        previews.set(row.collection_id, bucket);
      }
    }
  }

  // Rule-based collections don't keep an explicit `collection_emails`
  // row per match, so the membership join above would always report
  // zero for them. Run the evaluator instead — same source of truth as
  // the detail page. The fan-out is fine in practice because a single
  // user only has a handful of rule-based collections, but a future
  // optimisation could batch them into a single materialised view.
  await Promise.all(
    ruleRows.map(async ({ row, rules }) => {
      try {
        const ids = await evaluateCollectionRuleIds(supabase, rules);
        counts.set(row.id, ids.length);
        previews.set(row.id, ids.slice(0, PREVIEW_EMAIL_COUNT));
      } catch (err) {
        console.warn("Failed to evaluate rule-based collection for preview", {
          collectionId: row.id,
          err
        });
      }
    })
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    icon: readIcon(row.icon),
    shareSlug: row.share_slug,
    emailCount: counts.get(row.id) ?? 0,
    previewEmailIds: previews.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Lightweight `{ id, name }[]` list used by the sidebar + the "Add to
 * collection" popover on every Explore card. Same ordering as
 * `listCollectionsWithPreviews` so the two stay in sync visually.
 */
export async function listCollectionSummaries(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CollectionSummary[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, icon, share_slug, rules, last_viewed_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const summaries = await Promise.all(
    rows.map(async (row) => {
      const rules = safeParseStoredRules(row.rules);
      let hasNewEmails = false;
      if (rules && row.last_viewed_at) {
        hasNewEmails = await ruleCollectionHasEmailsAddedAfter(
          supabase,
          rules,
          row.last_viewed_at
        );
      }
      return {
        id: row.id,
        name: row.name,
        icon: readIcon(row.icon),
        shareSlug: row.share_slug,
        ...(hasNewEmails ? { hasNewEmails: true } : {})
      };
    })
  );
  return summaries;
}

/**
 * Persists (or clears) the cached event detection payload. The caller
 * owns the payload shape — both the fresh-detection write and the
 * confirm / dismiss mutations funnel through here.
 */
export async function saveCollectionEventDetection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  detection: CollectionEventDetection | null
): Promise<boolean> {
  const { data, error } = await supabase
    .from("collections")
    .update({
      event_detection: detection === null ? null : (detection as unknown as Json)
    })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

/**
 * Marks a collection as viewed by its owner. Clears the sidebar "new
 * emails" dot for rule-based collections until another match arrives.
 */
export async function markCollectionViewed(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<void> {
  const { error } = await supabase
    .from("collections")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", collectionId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Owner-side detail view for `/collections/[id]`. Mirrors the embed +
 * logo-signing flow used by `listSavedEmails`.
 */
const COLLECTION_DETAIL_COLUMNS =
  "id, name, icon, share_slug, user_id, shared_with_team, notify_new_matches, created_at, updated_at, rules, event_detection";

type CollectionDetailRow = {
  id: string;
  name: string;
  icon: string | null;
  share_slug: string;
  user_id: string;
  shared_with_team: boolean;
  notify_new_matches: boolean;
  created_at: string;
  updated_at: string;
  rules: Json | null;
  event_detection: Json | null;
};

/** Build a CollectionDetail from a fetched row (owner or team-reader path). */
async function buildCollectionDetail(
  supabase: SupabaseClient<Database>,
  data: CollectionDetailRow
): Promise<CollectionDetail> {
  const rules = safeParseStoredRules(data.rules);
  const emails = rules
    ? await evaluateCollectionRules(supabase, rules)
    : await loadCollectionEmails(supabase, data.id);

  return {
    id: data.id,
    name: data.name,
    icon: readIcon(data.icon),
    shareSlug: data.share_slug,
    ownerId: data.user_id,
    sharedWithTeam: data.shared_with_team,
    notifyNewMatches: data.notify_new_matches,
    emailCount: emails.length,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    emails,
    rules,
    eventDetection: safeParseEventDetection(data.event_detection)
  };
}

export async function getCollectionForOwner(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<CollectionDetail | null> {
  const { data, error } = await supabase
    .from("collections")
    .select(COLLECTION_DETAIL_COLUMNS)
    .eq("id", collectionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return buildCollectionDetail(supabase, data as CollectionDetailRow);
}

/**
 * Read a collection by id WITHOUT the owner filter — RLS decides access, so
 * this returns the row when the caller owns it OR it's shared with their
 * team. Use for the detail page's team-reader path; callers compare
 * `ownerId` to the viewer to gate edit controls.
 */
export async function getCollectionForReader(
  supabase: SupabaseClient<Database>,
  collectionId: string
): Promise<CollectionDetail | null> {
  const { data, error } = await supabase
    .from("collections")
    .select(COLLECTION_DETAIL_COLUMNS)
    .eq("id", collectionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return buildCollectionDetail(supabase, data as CollectionDetailRow);
}

/** Set/clear the team-share flag. Owner-only (RLS + explicit user filter). */
export async function setCollectionShared(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  shared: boolean
): Promise<boolean> {
  const { data, error } = await supabase
    .from("collections")
    .update({ shared_with_team: shared })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

/** Owner-only: opt this collection in/out of new-match email alerts. */
export async function setCollectionNotifyNewMatches(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  notify: boolean
): Promise<boolean> {
  const { data, error } = await supabase
    .from("collections")
    .update({ notify_new_matches: notify })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export type NotifiableSmartCollection = {
  id: string;
  name: string;
  notifyNewMatches: boolean;
};

/**
 * The user's rule-based collections (a rule with at least one condition),
 * with their new-match alert opt-in. Powers the Settings notifications
 * checklist; manual collections are excluded since they never gain
 * automatic matches.
 */
export async function listNotifiableSmartCollections(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<NotifiableSmartCollection[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, rules, notify_new_matches")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const out: NotifiableSmartCollection[] = [];
  for (const row of data ?? []) {
    const rules = parseCollectionRules(row.rules);
    if (!rules || rules.conditions.length === 0) continue;
    out.push({
      id: row.id,
      name: row.name,
      notifyNewMatches: row.notify_new_matches
    });
  }
  return out;
}

/**
 * Deep-copy a team-shared collection into another user's account. Uses the
 * admin client (the recipient may be a lapsed member without archive access,
 * so RLS would block a session-client insert). The source MUST be
 * shared_with_team — the route also checks the recipient is on the owner's
 * team. The copy is private (shared_with_team=false) and gets its own slug;
 * manual collections copy their email membership, rule-based collections
 * copy the rule so the recipient's copy stays live.
 */
export async function copySharedCollection(
  admin: SupabaseClient<Database>,
  sourceCollectionId: string,
  targetUserId: string
): Promise<{ id: string; name: string } | null> {
  const { data: source, error } = await admin
    .from("collections")
    .select("name, icon, rules, shared_with_team")
    .eq("id", sourceCollectionId)
    .maybeSingle();

  if (error) throw error;
  if (!source || !source.shared_with_team) return null;

  const copyName = sanitizeName(`${source.name} (copy)`.slice(0, 120));

  let created: { id: string; name: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateShareSlug();
    const { data, error: insertError } = await admin
      .from("collections")
      .insert({
        user_id: targetUserId,
        name: copyName,
        icon: source.icon,
        rules: source.rules,
        share_slug: slug,
        shared_with_team: false
      })
      .select("id, name")
      .single();

    if (!insertError && data) {
      created = { id: data.id, name: data.name };
      break;
    }
    if (
      insertError &&
      (insertError.code === "23505" || /duplicate key/i.test(insertError.message))
    ) {
      continue;
    }
    if (insertError) throw insertError;
  }
  if (!created) {
    throw new Error("Failed to allocate a unique share slug after 5 attempts");
  }

  // Manual collection: copy the membership rows. (Rule-based collections
  // need none — the copied rule repopulates them.)
  if (!source.rules) {
    const { data: members, error: membersError } = await admin
      .from("collection_emails")
      .select("email_id")
      .eq("collection_id", sourceCollectionId);
    if (membersError) throw membersError;

    const rows = (members ?? []).map((m) => ({
      collection_id: created.id,
      email_id: m.email_id
    }));
    if (rows.length > 0) {
      const { error: copyError } = await admin
        .from("collection_emails")
        .insert(rows);
      if (copyError) throw copyError;
    }
  }

  return created;
}

/** A collection a teammate has shared with the viewer's team. */
export type TeamSharedCollection = {
  id: string;
  name: string;
  icon: CollectionIcon | null;
  shareSlug: string;
  ownerId: string;
  ownerName: string | null;
};

/**
 * Collections shared with the viewer's team by OTHER members. RLS returns
 * only same-team shared rows; owner display names are resolved via the
 * admin client (user_profiles is self-only under RLS).
 */
export async function listTeamSharedCollections(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  userId: string
): Promise<TeamSharedCollection[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, icon, share_slug, user_id")
    .eq("shared_with_team", true)
    .neq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ownerIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name, email")
    .in("user_id", ownerIds);
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.user_id, p.full_name || p.email])
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    icon: readIcon(r.icon),
    shareSlug: r.share_slug,
    ownerId: r.user_id,
    ownerName: nameById.get(r.user_id) ?? null
  }));
}

/**
 * Deepest discount each brand has run in the trailing window, across the
 * WHOLE archive — not just within a collection. The collection's own
 * emails may span only a few weeks, so this benchmarks a campaign's
 * discounts against how deep each brand goes in a typical year. Keyed by
 * company name to match the per-brand grouping in the insights figure.
 */
export async function getBrandDiscountBenchmarks(
  supabase: SupabaseClient<Database>,
  companyIds: string[],
  sinceIso: string
): Promise<Record<string, number>> {
  const ids = Array.from(new Set(companyIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from("captured_emails")
    .select("discount_percent, companies(id, name)")
    .in("company_id", ids)
    .not("discount_percent", "is", null)
    .gte("received_at", sinceIso)
    .limit(BENCHMARK_ROW_LIMIT);
  if (error) throw error;

  const benchmarks: Record<string, number> = {};
  for (const row of data ?? []) {
    const name = pickCompany(row.companies)?.name;
    if (!name) continue;
    const pct =
      row.discount_percent === null || row.discount_percent === undefined
        ? null
        : Number(row.discount_percent);
    if (pct === null || !Number.isFinite(pct) || pct <= 0) continue;
    benchmarks[name] = Math.max(benchmarks[name] ?? 0, pct);
  }
  return benchmarks;
}

/**
 * Public detail view for `/c/[slug]`. Always uses the admin client
 * because the visitor may be anonymous; the slug acts as the secret.
 */
export async function getCollectionBySlugPublic(
  adminClient: SupabaseClient<Database>,
  slug: string
): Promise<CollectionDetail | null> {
  const { data, error } = await adminClient
    .from("collections")
    .select(COLLECTION_DETAIL_COLUMNS)
    .eq("share_slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return buildCollectionDetail(adminClient, data as CollectionDetailRow);
}

/**
 * Returns true when `emailId` is a member of the collection identified
 * by `slug`. Used by the public render endpoint to refuse requests
 * for emails the link wasn't actually shared for.
 */
export async function isEmailInPublicCollection(
  adminClient: SupabaseClient<Database>,
  slug: string,
  emailId: string
): Promise<boolean> {
  // First check whether this is a rule-based collection — if so the
  // public membership is computed, not stored, so the standard join
  // below would always return zero rows.
  const { data: collection, error: collectionError } = await adminClient
    .from("collections")
    .select("id, rules")
    .eq("share_slug", slug)
    .maybeSingle();
  if (collectionError) throw collectionError;
  if (!collection) return false;

  const rules = safeParseStoredRules(collection.rules);
  if (rules) {
    const ids = await evaluateCollectionRuleIds(adminClient, rules);
    return ids.includes(emailId);
  }

  const { data, error } = await adminClient
    .from("collection_emails")
    .select("email_id")
    .eq("collection_id", collection.id)
    .eq("email_id", emailId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function createCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  rawName: string,
  icon?: CollectionIcon | null
): Promise<CollectionSummary> {
  const name = sanitizeName(rawName);
  const safeIcon = isCollectionIcon(icon) ? icon : null;

  // Retry on the (astronomically unlikely) chance of a slug collision
  // — the table has a unique index, so we'd get a 23505 otherwise.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateShareSlug();
    const { data, error } = await supabase
      .from("collections")
      .insert({ user_id: userId, name, share_slug: slug, icon: safeIcon })
      .select("id, name, icon, share_slug")
      .single();

    if (!error && data) {
      return {
        id: data.id,
        name: data.name,
        icon: readIcon(data.icon),
        shareSlug: data.share_slug
      };
    }

    if (error && (error.code === "23505" || /duplicate key/i.test(error.message))) {
      continue;
    }
    if (error) throw error;
  }
  throw new Error("Failed to allocate a unique share slug after 5 attempts");
}

export async function renameCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  rawName: string
): Promise<CollectionSummary | null> {
  const name = sanitizeName(rawName);
  const { data, error } = await supabase
    .from("collections")
    .update({ name })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id, name, icon, share_slug")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    icon: readIcon(data.icon),
    shareSlug: data.share_slug
  };
}

/**
 * Set (or clear, with `null`) a collection's emoji icon. Validates the
 * value against the curated allow-list — anything else is rejected with
 * `CollectionIconValidationError` so the API layer can return a 400.
 */
export async function setCollectionIcon(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  icon: CollectionIcon | null
): Promise<CollectionSummary | null> {
  if (icon !== null && !isCollectionIcon(icon)) {
    throw new CollectionIconValidationError("Unsupported collection icon");
  }
  const { data, error } = await supabase
    .from("collections")
    .update({ icon })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id, name, icon, share_slug")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    icon: readIcon(data.icon),
    shareSlug: data.share_slug
  };
}

/**
 * Persist (or clear) the rules attached to a collection. Pass `null`
 * to flip the collection back into manual mode. The caller is
 * responsible for validating the payload via `parseCollectionRules`
 * first.
 */
export async function setCollectionRules(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  rules: CollectionRules | null
): Promise<boolean> {
  const { data, error } = await supabase
    .from("collections")
    .update({
      rules: rules === null ? null : (rules as unknown as Json),
      // Treat the current membership snapshot as "seen" so saving
      // rules does not light up the sidebar dot for emails already
      // in the collection.
      ...(rules !== null
        ? { last_viewed_at: new Date().toISOString() }
        : {})
    })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function deleteCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<boolean> {
  const { error, count } = await supabase
    .from("collections")
    .delete({ count: "exact" })
    .eq("id", collectionId)
    .eq("user_id", userId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Idempotent membership add. Validates the collection belongs to the
 * user first so PostgREST doesn't 23503 on the insert when the caller
 * tries to write into someone else's collection — RLS would have
 * blocked it either way, but a clean 404 is friendlier.
 */
export async function addEmailToCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  emailId: string
): Promise<"added" | "exists" | "missing"> {
  const owned = await assertCollectionOwnership(supabase, userId, collectionId);
  if (!owned) return "missing";

  const { error } = await supabase
    .from("collection_emails")
    .upsert(
      { collection_id: collectionId, email_id: emailId },
      { onConflict: "collection_id,email_id", ignoreDuplicates: true }
    );

  if (error) throw error;
  await touchCollection(supabase, collectionId);
  return "added";
}

export async function removeEmailFromCollection(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string,
  emailId: string
): Promise<boolean> {
  const owned = await assertCollectionOwnership(supabase, userId, collectionId);
  if (!owned) return false;

  const { error } = await supabase
    .from("collection_emails")
    .delete()
    .eq("collection_id", collectionId)
    .eq("email_id", emailId);

  if (error) throw error;
  await touchCollection(supabase, collectionId);
  return true;
}

/**
 * Returns the set of collection ids that contain `emailId` for the
 * current user. Used by the "Add to collection" popover so it can
 * pre-check the rows already containing the email.
 */
export async function listCollectionMembership(
  supabase: SupabaseClient<Database>,
  userId: string,
  emailId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("collection_emails")
    .select("collection_id, collections!inner(user_id)")
    .eq("email_id", emailId)
    .eq("collections.user_id", userId);

  if (error) throw error;
  return (data ?? []).map((row) => row.collection_id);
}

// ---------- Rule evaluation ----------

/**
 * Run the saved rule against `captured_emails` and return matching
 * `ExploreEmailCard`s, signed logos and all. Mirrors the embedding
 * shape `loadCollectionEmails` uses so the UI doesn't have to care
 * whether a collection is manual or rule-based.
 *
 * Compilation strategy:
 *  - Every condition is turned into a `Filter` (or a small set of
 *    them, for the brand-name search that has to OR across columns).
 *  - For `AND` we chain `.in()` / `.eq()` / `.gte()` etc. one filter
 *    at a time. The brand-name search collapses to a single `.or()`
 *    for that condition only.
 *  - For `OR` every filter is appended to a single `.or()` string so
 *    PostgREST evaluates them as one disjunction.
 *
 * Brand IDs from text search and market filters are resolved up-front
 * so the `captured_emails` query never has to reach into `companies`.
 */
export async function evaluateCollectionRules(
  client: SupabaseClient<Database>,
  rules: CollectionRules
): Promise<ExploreEmailCard[]> {
  const compiled = await compileRules(client, rules);
  if (compiled === "no_match") {
    return [];
  }

  let query = client
    .from("captured_emails")
    .select(
      `id, subject, preheader, received_at, category, has_gif, has_dark_mode,
       discount_percent, promo_code, company_id, duplicate_of,
       companies(id, slug, name, domain, markets, logo_storage_path)`
    )
    .order("received_at", { ascending: false })
    .limit(RULE_EVAL_LIMIT);

  // The scope (past / future) is an outer filter — semantically it's
  // ALWAYS AND'd with the rest of the rule, even when the per-
  // condition combinator is OR. PostgREST chains additional `.gte()` /
  // `.lt()` calls with implicit AND, so we can just tack them on
  // before the combinator clause runs.
  if (rules.scope === "future" && rules.appliedAt) {
    query = query.gte("received_at", rules.appliedAt);
  } else if (rules.scope === "past" && rules.appliedAt) {
    query = query.lt("received_at", rules.appliedAt);
  }

  // The optional time window is likewise an outer AND on `received_at`.
  const window = timeWindowBounds(rules.timeWindow);
  if (window.gte) query = query.gte("received_at", window.gte);
  if (window.lte) query = query.lte("received_at", window.lte);

  if (compiled.combinator === "AND") {
    for (const filter of compiled.filters) {
      switch (filter.type) {
        case "category_in":
          query =
            filter.values.length === 0
              ? query.eq("id", IMPOSSIBLE_ID)
              : query.in("category", filter.values);
          break;
        case "country_in":
          query =
            filter.values.length === 0
              ? query.eq("id", IMPOSSIBLE_ID)
              : query.in("detected_country", filter.values);
          break;
        case "in_company":
          query =
            filter.ids.length === 0
              ? query.eq("id", IMPOSSIBLE_ID)
              : query.in("company_id", filter.ids);
          break;
        case "discount":
          query =
            filter.op === "gte"
              ? query.gte("discount_percent", filter.value)
              : filter.op === "lte"
                ? query.lte("discount_percent", filter.value)
                : query.eq("discount_percent", filter.value);
          break;
        case "search":
          query = query.or(buildSearchOrClause(filter.term, filter.brandIds));
          break;
      }
    }
  } else {
    const parts = orParts(compiled.filters);
    query =
      parts.length === 0
        ? query.eq("id", IMPOSSIBLE_ID)
        : query.or(parts.join(","));
  }

  const { data, error } = await query;
  if (error) throw error;

  // Collapse list-copies of multi-segment sends so a rule that matches a
  // campaign yields one card, not one per inbox segment — same intent as
  // Explore's `duplicate_of IS NULL` filter. Rule rows are the email rows
  // themselves, so the group key reads straight off the row.
  const rows = collapseDuplicateRows(data ?? [], (row) => row);
  const logoPaths = new Set<string>();
  for (const row of rows) {
    const company = pickCompany(row.companies);
    if (company?.logo_storage_path) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0
      ? await getSignedAssets(Array.from(logoPaths), {
          transform: BRAND_LOGO_TRANSFORM
        })
      : {};

  const cards: ExploreEmailCard[] = [];
  for (const row of rows) {
    const card = ruleRowToCard(row, signed);
    if (card) cards.push(card);
  }
  return cards;
}

/**
 * Same evaluator as above but only resolves the matching email ids.
 * Used by the public-render guard which only needs to know whether a
 * given email belongs to the rule-derived membership.
 */
type RuleIdQueryOptions = {
  /**
   * Only emails ingested (added to the system) strictly after this
   * timestamp. Compared against `created_at` — i.e. "when did this row
   * appear" — rather than `received_at` ("when did the brand send it"),
   * so a late-ingested email with an older send date still counts as
   * newly added to a rule-based collection.
   */
  createdAfter?: string;
  limit?: number;
};

/**
 * Returns whether any email matching the rule set was added to the
 * system after the given timestamp. Powers the sidebar "new emails"
 * indicator for rule-based (auto-populated) collections.
 */
export async function ruleCollectionHasEmailsAddedAfter(
  client: SupabaseClient<Database>,
  rules: CollectionRules,
  after: string
): Promise<boolean> {
  const ids = await evaluateCollectionRuleIds(client, rules, {
    createdAfter: after,
    limit: 1
  });
  return ids.length > 0;
}

export async function evaluateCollectionRuleIds(
  client: SupabaseClient<Database>,
  rules: CollectionRules,
  options?: RuleIdQueryOptions
): Promise<string[]> {
  const compiled = await compileRules(client, rules);
  if (compiled === "no_match") {
    return [];
  }
  let query = client
    .from("captured_emails")
    .select("id")
    .limit(options?.limit ?? RULE_EVAL_LIMIT);

  if (options?.createdAfter) {
    query = query.gt("created_at", options.createdAfter);
  }

  if (rules.scope === "future" && rules.appliedAt) {
    query = query.gte("received_at", rules.appliedAt);
  } else if (rules.scope === "past" && rules.appliedAt) {
    query = query.lt("received_at", rules.appliedAt);
  }

  const window = timeWindowBounds(rules.timeWindow);
  if (window.gte) query = query.gte("received_at", window.gte);
  if (window.lte) query = query.lte("received_at", window.lte);

  if (compiled.combinator === "AND") {
    for (const filter of compiled.filters) {
      switch (filter.type) {
        case "category_in":
          query =
            filter.values.length === 0
              ? query.eq("id", IMPOSSIBLE_ID)
              : query.in("category", filter.values);
          break;
        case "country_in":
          query =
            filter.values.length === 0
              ? query.eq("id", IMPOSSIBLE_ID)
              : query.in("detected_country", filter.values);
          break;
        case "in_company":
          query =
            filter.ids.length === 0
              ? query.eq("id", IMPOSSIBLE_ID)
              : query.in("company_id", filter.ids);
          break;
        case "discount":
          query =
            filter.op === "gte"
              ? query.gte("discount_percent", filter.value)
              : filter.op === "lte"
                ? query.lte("discount_percent", filter.value)
                : query.eq("discount_percent", filter.value);
          break;
        case "search":
          query = query.or(buildSearchOrClause(filter.term, filter.brandIds));
          break;
      }
    }
  } else {
    const parts = orParts(compiled.filters);
    query =
      parts.length === 0
        ? query.eq("id", IMPOSSIBLE_ID)
        : query.or(parts.join(","));
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

const IMPOSSIBLE_ID = "00000000-0000-0000-0000-000000000000";

type CompiledFilter =
  | { type: "in_company"; ids: string[] }
  | { type: "category_in"; values: string[] }
  | { type: "country_in"; values: string[] }
  | { type: "discount"; op: "gte" | "lte" | "eq"; value: number }
  | { type: "search"; term: string; brandIds: string[] };

type CompiledRules = {
  combinator: CollectionRuleCombinator;
  filters: CompiledFilter[];
};

async function compileRules(
  client: SupabaseClient<Database>,
  rules: CollectionRules
): Promise<CompiledRules | "no_match"> {
  if (rules.conditions.length === 0) {
    // An empty ruleset is treated as "nothing matches" — otherwise we'd
    // silently dump the entire inbox into the collection the moment the
    // user removed all their conditions, which is surprising.
    return "no_match";
  }

  const filters: CompiledFilter[] = [];

  for (const cond of rules.conditions) {
    switch (cond.field) {
      case "category":
        if (cond.values.length === 0) {
          if (rules.combinator === "AND") return "no_match";
          break;
        }
        filters.push({ type: "category_in", values: cond.values });
        break;
      case "brand":
        if (cond.values.length === 0) {
          if (rules.combinator === "AND") return "no_match";
          break;
        }
        filters.push({ type: "in_company", ids: cond.values });
        break;
      case "market": {
        if (cond.values.length === 0) {
          if (rules.combinator === "AND") return "no_match";
          break;
        }
        const ids = await lookupCompanyIdsByMarkets(client, cond.values);
        if (rules.combinator === "AND" && ids.length === 0) {
          // Under AND, any single condition with zero matches collapses
          // the whole rule. Under OR we just drop the empty filter and
          // let the other conditions stand.
          return "no_match";
        }
        if (ids.length > 0) {
          filters.push({ type: "in_company", ids });
        }
        break;
      }
      case "country":
        if (cond.values.length === 0) {
          if (rules.combinator === "AND") return "no_match";
          break;
        }
        filters.push({ type: "country_in", values: cond.values });
        break;
      case "discount_percent":
        filters.push({
          type: "discount",
          op: cond.operator,
          value: cond.value
        });
        break;
      case "search": {
        const term = sanitizeIlikeTerm(cond.value);
        if (term.length === 0) {
          if (rules.combinator === "AND") return "no_match";
          break;
        }
        const brandIds = await lookupCompanyIdsByName(client, term);
        filters.push({ type: "search", term, brandIds });
        break;
      }
    }
  }

  if (filters.length === 0) {
    return "no_match";
  }

  return { combinator: rules.combinator, filters };
}

function orParts(filters: CompiledFilter[]): string[] {
  const parts: string[] = [];
  for (const filter of filters) {
    switch (filter.type) {
      case "category_in": {
        const safe = filter.values
          .filter((v) => CATEGORY_LOOKUP.has(v))
          .map(escapeOrValue);
        if (safe.length > 0) {
          parts.push(`category.in.(${safe.join(",")})`);
        }
        break;
      }
      case "country_in": {
        const safe = filter.values.filter((code) => /^[A-Z]{2}$/.test(code));
        if (safe.length > 0) {
          parts.push(`detected_country.in.(${safe.join(",")})`);
        }
        break;
      }
      case "in_company": {
        const safe = filter.ids.filter((id) => UUID_PATTERN.test(id));
        if (safe.length > 0) {
          parts.push(`company_id.in.(${safe.join(",")})`);
        }
        break;
      }
      case "discount":
        parts.push(`discount_percent.${filter.op}.${filter.value}`);
        break;
      case "search":
        parts.push(...buildSearchOrParts(filter.term, filter.brandIds));
        break;
    }
  }
  return parts;
}

function buildSearchOrParts(term: string, brandIds: string[]): string[] {
  const wrapped = `*${term}*`;
  const parts = [
    `subject.ilike.${wrapped}`,
    `preheader.ilike.${wrapped}`,
    `primary_cta_text.ilike.${wrapped}`,
    `plain_text.ilike.${wrapped}`
  ];
  const safe = brandIds.filter((id) => UUID_PATTERN.test(id));
  if (safe.length > 0) {
    parts.push(`company_id.in.(${safe.join(",")})`);
  }
  return parts;
}

function buildSearchOrClause(term: string, brandIds: string[]): string {
  return buildSearchOrParts(term, brandIds).join(",");
}

/**
 * PostgREST's `.or()` is a comma-separated list of `column.op.value`
 * triples. Bare commas, parentheses and double quotes inside a value
 * would break the parser; for the category enum and other short
 * strings this is more of a safety net than a real concern, but it's
 * cheap to be defensive.
 */
function escapeOrValue(value: string): string {
  return value.replace(/[",()]/g, " ");
}

async function lookupCompanyIdsByMarkets(
  client: SupabaseClient<Database>,
  markets: string[]
): Promise<string[]> {
  if (markets.length === 0) return [];
  const { data, error } = await client
    .from("companies")
    .select("id")
    .overlaps("markets", markets)
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

async function lookupCompanyIdsByName(
  client: SupabaseClient<Database>,
  term: string
): Promise<string[]> {
  const { data, error } = await client
    .from("companies")
    .select("id")
    .ilike("name", `%${term}%`)
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

function ruleRowToCard(
  row: {
    id: string;
    subject: string;
    preheader: string | null;
    received_at: string;
    category: string;
    has_gif: boolean | null;
    has_dark_mode: boolean | null;
    discount_percent: number | null;
    promo_code: string | null;
    company_id: string | null;
    companies: CompaniesField;
  },
  signed: Record<string, string>
): ExploreEmailCard | null {
  const company = pickCompany(row.companies);
  const logoPath = company?.logo_storage_path ?? null;
  return {
    id: row.id,
    subject: row.subject,
    preheader: row.preheader ?? null,
    companyId: company?.id ?? null,
    companySlug: company?.slug ?? null,
    companyName: company?.name ?? "Unknown",
    companyDomain: company?.domain ?? null,
    companyMarkets: pickCompanyMarkets(company),
    companyLogoUrl: logoPath ? signed[logoPath] ?? null : null,
    receivedAt: row.received_at,
    category: row.category,
    hasGif: row.has_gif ?? false,
    hasDarkMode: row.has_dark_mode ?? false,
    discountPercent:
      row.discount_percent === null || row.discount_percent === undefined
        ? null
        : Number(row.discount_percent),
    promoCode: row.promo_code ?? null
  };
}

/**
 * Defensive read of the `rules` column: we trust the validator on
 * write, but the column is plain JSONB so a corrupted or hand-edited
 * row shouldn't crash the detail page. Anything we can't parse is
 * treated as "no rules" (i.e. fall back to manual membership).
 */
function safeParseStoredRules(value: unknown): CollectionRules | null {
  try {
    return parseCollectionRules(value);
  } catch (err) {
    console.warn("Ignoring malformed collection rules", err);
    return null;
  }
}

/**
 * Mirror of `searchExploreEmails`'s ILIKE sanitizer: strip the
 * characters that would either break the PostgREST `or()` parser or
 * accidentally turn the user's input into wildcards.
 */
function sanitizeIlikeTerm(input: string): string {
  return input
    .replace(/[%_,()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- internal helpers ----------

async function loadCollectionEmails(
  client: SupabaseClient<Database>,
  collectionId: string
): Promise<ExploreEmailCard[]> {
  const { data, error } = await client
    .from("collection_emails")
    .select(
      `added_at,
       captured_emails!inner(
         id, subject, preheader, received_at, category, has_gif, has_dark_mode,
         discount_percent, promo_code, company_id, duplicate_of,
         companies(id, slug, name, domain, markets, logo_storage_path)
       )`
    )
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false });

  if (error) throw error;

  // Collapse list-copies of multi-segment sends to one card, mirroring
  // Explore's `duplicate_of IS NULL` filter. Manual membership stores
  // literal email ids (which may be duplicate copies, not the canonical),
  // so we group in memory rather than filtering in SQL.
  const rows = collapseDuplicateRows(data ?? [], (row) =>
    pickEmail(row.captured_emails)
  );
  const logoPaths = new Set<string>();
  for (const row of rows) {
    const email = pickEmail(row.captured_emails);
    const company = email ? pickCompany(email.companies) : null;
    if (company?.logo_storage_path) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0
      ? await getSignedAssets(Array.from(logoPaths), {
          transform: BRAND_LOGO_TRANSFORM
        })
      : {};

  const cards: ExploreEmailCard[] = [];
  for (const row of rows) {
    const card = toExploreCard(row.captured_emails, signed);
    if (card) cards.push(card);
  }
  return cards;
}

async function assertCollectionOwnership(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("collections")
    .select("id")
    .eq("id", collectionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function touchCollection(
  supabase: SupabaseClient<Database>,
  collectionId: string
): Promise<void> {
  // Best-effort: bump `updated_at` so the sidebar's most-recent
  // ordering reflects the latest membership change. We swallow the
  // error so a missing trigger never blocks a membership write — the
  // BEFORE UPDATE trigger does the actual timestamping.
  const { error } = await supabase
    .from("collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", collectionId);
  if (error) {
    console.warn("Failed to touch collection updated_at", error);
  }
}

/**
 * Read the stored icon, dropping anything outside the curated allow-list
 * (a `null` column, a legacy row, or a hand-edited value) back to `null`
 * so the UI consistently falls back to the generic glyph.
 */
function readIcon(value: unknown): CollectionIcon | null {
  return isCollectionIcon(value) ? value : null;
}

function sanitizeName(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    throw new Error("Collection name is required");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return trimmed.slice(0, MAX_NAME_LENGTH);
  }
  return trimmed;
}

/**
 * URL-safe random slug. 12 bytes of randomness rendered as base64url
 * gives 16 characters — short enough to share verbally if needed, and
 * with ~96 bits of entropy a brute-force enumeration is infeasible.
 */
function generateShareSlug(): string {
  return randomBytes(SLUG_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type EmailField =
  | {
      id: string;
      subject: string;
      preheader: string | null;
      received_at: string;
      category: string;
      has_gif: boolean | null;
      has_dark_mode: boolean | null;
      discount_percent: number | null;
      promo_code: string | null;
      company_id: string | null;
      duplicate_of: string | null;
      companies: CompaniesField;
    }
  | Array<{
      id: string;
      subject: string;
      preheader: string | null;
      received_at: string;
      category: string;
      has_gif: boolean | null;
      has_dark_mode: boolean | null;
      discount_percent: number | null;
      promo_code: string | null;
      company_id: string | null;
      duplicate_of: string | null;
      companies: CompaniesField;
    }>
  | null
  | undefined;

type CompaniesField =
  | {
      id: string;
      slug?: string | null;
      name: string;
      domain?: string | null;
      markets?: string[] | null;
      logo_storage_path?: string | null;
    }
  | Array<{
      id: string;
      slug?: string | null;
      name: string;
      domain?: string | null;
      markets?: string[] | null;
      logo_storage_path?: string | null;
    }>
  | null
  | undefined;

function pickEmail(value: EmailField) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function pickCompany(value: CompaniesField) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toExploreCard(
  value: EmailField,
  signed: Record<string, string>
): ExploreEmailCard | null {
  const email = pickEmail(value);
  if (!email) return null;
  const company = pickCompany(email.companies);
  const logoPath = company?.logo_storage_path ?? null;

  return {
    id: email.id,
    subject: email.subject,
    preheader: email.preheader ?? null,
    companyId: company?.id ?? null,
    companySlug: company?.slug ?? null,
    companyName: company?.name ?? "Unknown",
    companyDomain: company?.domain ?? null,
    companyMarkets: pickCompanyMarkets(company),
    companyLogoUrl: logoPath ? signed[logoPath] ?? null : null,
    receivedAt: email.received_at,
    category: email.category,
    hasGif: email.has_gif ?? false,
    hasDarkMode: email.has_dark_mode ?? false,
    discountPercent:
      email.discount_percent === null || email.discount_percent === undefined
        ? null
        : Number(email.discount_percent),
    promoCode: email.promo_code ?? null
  };
}

/**
 * Defensive read for the embedded `companies.markets` array. Filters
 * out non-strings so a hand-edited row can't poison the API payload.
 */
function pickCompanyMarkets(
  company: { markets?: string[] | null } | null
): string[] {
  if (!company || !Array.isArray(company.markets)) return [];
  return company.markets.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}
