import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_CATEGORIES, type EmailCategory } from "./admin-types";
import {
  safeParseEventDetection,
  type CollectionEventDetection
} from "./collection-event-shared";
import { type CollectionIcon, isCollectionIcon } from "./collection-icons";
import { cleanPreheaderText } from "./extract-metadata";
import { resolveBrandLogo } from "./logo-dev";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import { collapseDuplicateRows } from "./dedup";
import { buildSearchMatcher, matcherValue, type SearchMatcher } from "./search-term";
import { fetchAllRows } from "./supabase-paging";
import { after } from "next/server";
import { getSupabaseAdmin } from "./supabase-admin";
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
  /** Smart collection whose stored matches are still being built. */
  matchBuilding?: boolean;
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
   * True when a matching email was ingested after the owner last opened
   * this rule-based collection. Set by the stored-match worker when it
   * adds matches for new emails, cleared by viewing the collection.
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
  /** Smart collection whose stored matches are still being built. */
  matchBuilding?: boolean;
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
  /**
   * Non-null while a smart collection's stored matches are being built
   * (first time, after a rule change, or after falling far behind).
   * `emails` is empty until the build finishes.
   */
  matchBuild: CollectionMatchBuild | null;
  /**
   * Exact totals of a built smart collection (`emails` holds only the
   * newest RULE_EVAL_LIMIT). Null for manual collections and while
   * building.
   */
  matchTotals: CollectionMatchTotals | null;
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

  // Rule-based collections read their stored matches (same source of
  // truth as the detail page). No catch-up here: the grid shows what was
  // matched as of the last view or worker pass, and opening a collection
  // brings it current. A collection with no build yet gets one started.
  const building = new Set<string>();
  if (ruleRows.length > 0) {
    const admin = getSupabaseAdmin();
    await Promise.all(
      ruleRows.map(async ({ row, rules }) => {
        if (rules.conditions.length === 0) return;
        try {
          const build = await ensureCollectionMatches(admin, row.id, rules, {
            catchUp: false
          });
          if (build) {
            building.add(row.id);
            return;
          }
          const [ids, totals] = await Promise.all([
            loadMatchedEmailIds(admin, row.id, rules, PREVIEW_EMAIL_COUNT),
            loadMatchTotals(admin, row.id, rules)
          ]);
          counts.set(row.id, totals.emails);
          previews.set(row.id, ids);
        } catch (err) {
          console.warn("Failed to load rule-based collection for preview", {
            collectionId: row.id,
            err
          });
        }
      })
    );
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    icon: readIcon(row.icon),
    shareSlug: row.share_slug,
    emailCount: counts.get(row.id) ?? 0,
    previewEmailIds: previews.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(building.has(row.id) ? { matchBuilding: true } : {})
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
    .select(
      "id, name, icon, share_slug, has_new_matches, collection_match_builds(status)"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    icon: readIcon(row.icon),
    shareSlug: row.share_slug,
    ...(row.has_new_matches ? { hasNewEmails: true } : {}),
    ...(embeddedBuildStatus(row.collection_match_builds) === "building"
      ? { matchBuilding: true }
      : {})
  }));
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
 * Marks a collection as viewed by its owner: clears the sidebar "new
 * emails" dot until the ingest hook flags another match. The write also
 * bumps `updated_at`, which floats the collection to the top of the
 * sidebar.
 */
export async function markCollectionViewed(
  supabase: SupabaseClient<Database>,
  userId: string,
  collectionId: string
): Promise<void> {
  const { error } = await supabase
    .from("collections")
    .update({ last_viewed_at: new Date().toISOString(), has_new_matches: false })
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
  // Smart collections read their stored matches (see "Stored matches"
  // below) on the service-role client. Safe because every caller has
  // already read `data` through the viewer's own access (owner filter or
  // RLS), and archive rows are readable by every signed-in user anyway
  // (free tier sees the whole catalogue).
  let emails: ExploreEmailCard[] = [];
  let matchBuild: CollectionMatchBuild | null = null;
  let matchTotals: CollectionMatchTotals | null = null;
  if (!rules) {
    emails = await loadCollectionEmails(supabase, data.id);
  } else if (rules.conditions.length > 0) {
    const admin = getSupabaseAdmin();
    // Before ensuring, so a dormant collection's catch-up counts as
    // active and the cron worker carries it on past this request.
    await markCollectionMatchesOpened(admin, data.id);
    matchBuild = await ensureCollectionMatches(admin, data.id, rules, {
      catchUp: true
    });
    if (!matchBuild) {
      [emails, matchTotals] = await Promise.all([
        loadMatchedEmails(admin, data.id, rules),
        loadMatchTotals(admin, data.id, rules)
      ]);
    }
  }

  return {
    id: data.id,
    name: data.name,
    icon: readIcon(data.icon),
    shareSlug: data.share_slug,
    ownerId: data.user_id,
    sharedWithTeam: data.shared_with_team,
    notifyNewMatches: data.notify_new_matches,
    emailCount: matchTotals?.emails ?? emails.length,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    emails,
    rules,
    eventDetection: safeParseEventDetection(data.event_detection),
    matchBuild,
    matchTotals
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

  // Aggregated in SQL: the row scan this replaced was cut off at PostgREST's
  // 1,000-row cap, in no particular order, so a collection spanning a dozen
  // promo-heavy brands lost an arbitrary slice of each brand's discounts.
  const { data, error } = await supabase.rpc("brand_max_discounts", {
    p_company_ids: ids,
    p_since: sinceIso
  });
  if (error) throw error;

  const benchmarks: Record<string, number> = {};
  for (const row of data ?? []) {
    const pct = Number(row.max_discount);
    if (!row.company_name || !Number.isFinite(pct) || pct <= 0) continue;
    benchmarks[row.company_name] = Math.max(benchmarks[row.company_name] ?? 0, pct);
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
    // The same stored matches (and scope / window bounds) the public page
    // renders from. While a build runs the page shows no emails, so
    // nothing is allowed then either.
    const bounds = ruleReceivedBounds(rules);
    let query = adminClient
      .from("collection_matches")
      .select("email_id")
      .eq("collection_id", collection.id)
      .eq("email_id", emailId);
    if (bounds.gte) query = query.gte("received_at", bounds.gte);
    if (bounds.lt) query = query.lt("received_at", bounds.lt);
    if (bounds.lte) query = query.lte("received_at", bounds.lte);
    const { data: match, error: matchError } = await query.maybeSingle();
    if (matchError) throw matchError;
    return Boolean(match);
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

/**
 * Total collections the user owns. Cheap `head:true` count used by the
 * free-tier cap check.
 */
export async function countCollections(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("collections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
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
      // Matches flagged under the old rules no longer mean anything, and
      // what the new rules match is on screen as the user saves.
      has_new_matches: false
    })
    .eq("id", collectionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  // New conditions are picked up by the next read (ensureCollectionMatches
  // sees the key change and rebuilds). Removing the rules leaves nothing to
  // rebuild against, so clear the stored matches here.
  if (data && (rules === null || rules.conditions.length === 0)) {
    await clearCollectionMatches(getSupabaseAdmin(), collectionId);
  }
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

// ---------- Stored matches (smart collections) ----------
//
// A smart collection's matches live in `collection_matches`, built by
// walking the archive in ingest order, CHUNK emails per database call
// (`advance_collection_matches`). Each call is bounded work however big the
// archive gets, so a build never hits a statement timeout; it just takes
// longer, and the page shows progress plus an estimate meanwhile. The same
// cursor then keeps moving over newly ingested emails, so opening a
// collection only checks emails it hasn't seen before.
//
// Who moves the cursor:
//  - the pg_cron driven worker route
//    (`/api/admin/internal/build-collection-matches`, every 30 seconds while
//    there's work) runs builds, and keeps built ACTIVE collections current
//    at most every 5 minutes. When that adds matches for new emails it sets
//    the sidebar "new emails" dot.
//  - a build started by a request is also kicked off right away with
//    `after()`, so the first progress shows without waiting for the cron;
//  - a page view checks whatever is left inline (usually nothing), or starts
//    a measured catch-up when there's a lot (a collection opened after a
//    long break).
//
// Edits to existing emails or brands (markets, names, brand assignment,
// re-classification) are queued by database triggers and re-evaluated by
// the same advance call, so stored matches never drift from the rules.
//
// Dormancy: a collection nobody has opened in 30 days (see
// collection_match_dormant_before() in SQL) gets no background work, unless
// it sends new-match alert emails. Its next open catches it up. After 90
// days its stored matches are dropped and the next open rebuilds them.
//
// The stored matches cover the rule's CONDITIONS only. Scope (past/future
// cutoff) and the time window are applied on read against the stored
// received_at, so a rolling window stays right as time passes and editing
// only the window or scope doesn't trigger a rebuild.

/** Emails checked per database call. Roughly 0.2 to 1s of DB work. */
const MATCH_CHUNK = 1000;

/** How long a page view spends catching a ready collection up inline. */
const CATCH_UP_BUDGET_MS = 2_500;

/** A building collection with no progress this long gets a fresh kick. */
const STALLED_BUILD_MS = 20_000;

/** Background budget for a build kicked off from a request via `after()`. */
const AFTER_BUILD_BUDGET_MS = 40_000;

/** Opens closer together than this don't rewrite last_opened_at. */
const OPENED_STAMP_INTERVAL_MS = 60 * 60 * 1000;

export type CollectionMatchBuild = {
  status: "building";
  /**
   * "build": first build, or a rebuild after the conditions changed.
   * "catchUp": a built collection checking the emails that arrived while
   * nobody had it open.
   */
  kind: "build" | "catchUp";
  /** Emails checked so far in this build. */
  scanned: number;
  /** Emails this build has to check in total (an estimate at scale). */
  total: number;
  startedAt: string;
  /** Server clock when this snapshot was taken, for skew-free estimates. */
  serverNow: string;
};

type MatchBuildRow = {
  match_key: string;
  status: string;
  scanned: number;
  total: number;
  started_at: string;
  updated_at: string;
  ready_at: string | null;
};

type AdvanceResult = "ready" | "building" | "busy" | "stale" | "missing";

/**
 * Identity of what the stored matches were built for: the combinator and
 * the conditions, minus their client-side ids. Scope and time window are
 * deliberately left out (applied on read).
 */
function ruleMatchKey(rules: CollectionRules): string {
  return JSON.stringify({
    combinator: rules.combinator,
    conditions: rules.conditions.map((condition) => {
      const { id, ...rest } = condition;
      void id;
      return rest;
    })
  });
}

/** Compiled filters as the JSON `advance_collection_matches` evaluates. */
function serializeFilters(filters: CompiledFilter[]): Json {
  return filters.map((filter) =>
    filter.type === "search"
      ? {
          type: "search",
          pattern: filter.matcher.pattern,
          brandIds: filter.brandIds.filter((id) => UUID_PATTERN.test(id))
        }
      : filter
  ) as unknown as Json;
}

function buildSnapshot(row: MatchBuildRow): CollectionMatchBuild {
  return {
    status: "building",
    // A row that has been ready before and is building again without a
    // reset (reset clears ready_at) fell behind: a catch-up.
    kind: row.ready_at ? "catchUp" : "build",
    scanned: row.scanned,
    total: Math.max(row.total, row.scanned),
    startedAt: row.started_at,
    serverNow: new Date().toISOString()
  };
}

async function readMatchBuild(
  admin: SupabaseClient<Database>,
  collectionId: string
): Promise<MatchBuildRow | null> {
  const { data, error } = await admin
    .from("collection_match_builds")
    .select("match_key, status, scanned, total, started_at, updated_at, ready_at")
    .eq("collection_id", collectionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function resetCollectionMatches(
  admin: SupabaseClient<Database>,
  collectionId: string,
  matchKey: string | null
): Promise<void> {
  const { error } = await admin.rpc("reset_collection_matches", {
    p_collection_id: collectionId,
    p_match_key: matchKey
  });
  if (error) throw error;
}

/**
 * Record that someone opened the collection, which keeps it out of
 * dormancy. At most one write an hour; a no-op before the first build
 * exists (a new build row starts as just opened).
 */
async function markCollectionMatchesOpened(
  admin: SupabaseClient<Database>,
  collectionId: string
): Promise<void> {
  const now = Date.now();
  const { error } = await admin
    .from("collection_match_builds")
    .update({ last_opened_at: new Date(now).toISOString() })
    .eq("collection_id", collectionId)
    .lt("last_opened_at", new Date(now - OPENED_STAMP_INTERVAL_MS).toISOString());
  if (error) throw error;
}

/** Drop a collection's stored matches and build (rules removed). */
export async function clearCollectionMatches(
  admin: SupabaseClient<Database>,
  collectionId: string
): Promise<void> {
  await resetCollectionMatches(admin, collectionId, null);
}

/**
 * Move one collection's cursor forward until it's caught up, the deadline
 * passes, or another worker holds it. Rules are compiled once per call
 * (brand-name and market lookups), then each chunk is one RPC.
 */
async function advanceCollectionMatches(
  admin: SupabaseClient<Database>,
  collectionId: string,
  rules: CollectionRules,
  deadline: number,
  options: { flagNew: boolean }
): Promise<AdvanceResult> {
  const compiled = await compileRules(admin, rules);
  const filters = compiled === "no_match" ? [] : serializeFilters(compiled.filters);
  const combinator = compiled === "no_match" ? "AND" : compiled.combinator;
  const matchKey = ruleMatchKey(rules);

  for (;;) {
    const { data, error } = await admin.rpc("advance_collection_matches", {
      p_collection_id: collectionId,
      p_match_key: matchKey,
      p_combinator: combinator,
      p_filters: filters,
      p_limit: MATCH_CHUNK,
      p_flag_new: options.flagNew
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("advance_collection_matches returned no row");
    if (row.outcome !== "ok") return row.outcome as AdvanceResult;
    if (row.status === "ready") return "ready";
    if (Date.now() >= deadline) return "building";
  }
}

/**
 * Hand a build to the background: `after()` keeps the serverless function
 * alive past the response. Outside a request (scripts) `after` throws, and
 * the cron worker picks the build up within 30 seconds instead.
 */
function scheduleMatchBuild(collectionId: string): void {
  try {
    after(async () => {
      try {
        await runCollectionMatchWorker({
          collectionIds: [collectionId],
          budgetMs: AFTER_BUILD_BUDGET_MS
        });
      } catch (err) {
        console.error("Background collection match build failed", {
          collectionId,
          err
        });
      }
    });
  } catch {
    // Not in a request scope; the cron worker will continue it.
  }
}

/**
 * Make sure a smart collection's stored matches exist and fit its current
 * rules. Returns null when they're ready to read, or the build progress
 * while a build is running (the caller shows progress, not emails).
 *
 * `catchUp` also checks emails ingested since the last pass (the detail
 * page wants that; the grid doesn't need to pay for it).
 */
export async function ensureCollectionMatches(
  admin: SupabaseClient<Database>,
  collectionId: string,
  rules: CollectionRules,
  options: { catchUp: boolean }
): Promise<CollectionMatchBuild | null> {
  const matchKey = ruleMatchKey(rules);
  let build = await readMatchBuild(admin, collectionId);

  if (!build || build.match_key !== matchKey) {
    await resetCollectionMatches(admin, collectionId, matchKey);
    scheduleMatchBuild(collectionId);
    build = await readMatchBuild(admin, collectionId);
    if (!build) throw new Error("Collection match build missing after reset");
    return buildSnapshot(build);
  }

  if (build.status === "building") {
    if (Date.now() - new Date(build.updated_at).getTime() > STALLED_BUILD_MS) {
      scheduleMatchBuild(collectionId);
    }
    return buildSnapshot(build);
  }

  if (!options.catchUp) return null;

  // Active collections are kept current by the worker, so usually there's
  // nothing left and this costs one cheap query.
  const { data: backlogRows, error: backlogError } = await admin.rpc(
    "collection_match_backlog",
    { p_collection_id: collectionId, p_cap: MATCH_CHUNK }
  );
  if (backlogError) throw backlogError;
  const backlog = backlogRows?.[0];
  if (!backlog || (backlog.emails === 0 && backlog.rechecks === 0)) return null;

  if (backlog.emails < MATCH_CHUNK && backlog.rechecks < MATCH_CHUNK) {
    // A little: one advance call covers it, inline.
    const outcome = await advanceCollectionMatches(
      admin,
      collectionId,
      rules,
      Date.now() + CATCH_UP_BUDGET_MS,
      { flagNew: false }
    );
    if (outcome !== "stale" && outcome !== "missing") {
      // ready, or busy (a worker is mid-chunk; what's stored is current up
      // to that chunk, which is fine to show).
      return null;
    }
    // Rules changed between our read and the advance; start over with the
    // rules we were given (the caller just read them).
    await resetCollectionMatches(admin, collectionId, matchKey);
  } else {
    // A lot (opened after a long break): a measured catch-up in the
    // background, with the progress panel meanwhile.
    const { error } = await admin.rpc("start_collection_match_catch_up", {
      p_collection_id: collectionId,
      p_match_key: matchKey
    });
    if (error) throw error;
  }
  scheduleMatchBuild(collectionId);
  build = await readMatchBuild(admin, collectionId);
  return build && build.status === "building" ? buildSnapshot(build) : null;
}

/** Scope + time window, applied on read against the stored received_at. */
function ruleReceivedBounds(rules: CollectionRules): { gte?: string; lt?: string; lte?: string } {
  const bounds: { gte?: string; lt?: string; lte?: string } = {};
  if (rules.scope === "future" && rules.appliedAt) {
    bounds.gte = rules.appliedAt;
  } else if (rules.scope === "past" && rules.appliedAt) {
    bounds.lt = rules.appliedAt;
  }
  const window = timeWindowBounds(rules.timeWindow);
  if (window.gte && (!bounds.gte || window.gte > bounds.gte)) bounds.gte = window.gte;
  if (window.lte) bounds.lte = window.lte;
  return bounds;
}

/**
 * Newest stored matches as cards (same cap and duplicate collapsing the
 * live evaluator had). Embeds through the collection_matches → emails FK,
 * the same shape `loadCollectionEmails` reads from collection_emails.
 */
async function loadMatchedEmails(
  admin: SupabaseClient<Database>,
  collectionId: string,
  rules: CollectionRules
): Promise<ExploreEmailCard[]> {
  const bounds = ruleReceivedBounds(rules);
  let query = admin
    .from("collection_matches")
    .select(
      `received_at,
       captured_emails!inner(
         id, subject, preheader, received_at, category, has_gif, has_dark_mode,
         discount_percent, promo_code, company_id, duplicate_of,
         companies(id, slug, name, domain, markets, logo_storage_path, logo_source)
       )`
    )
    .eq("collection_id", collectionId);
  if (bounds.gte) query = query.gte("received_at", bounds.gte);
  if (bounds.lt) query = query.lt("received_at", bounds.lt);
  if (bounds.lte) query = query.lte("received_at", bounds.lte);

  const { data, error } = await query
    .order("received_at", { ascending: false })
    .limit(RULE_EVAL_LIMIT);
  if (error) throw error;
  return embeddedRowsToCards(data ?? []);
}

/** Newest stored match ids, for the grid's preview mosaic. */
async function loadMatchedEmailIds(
  admin: SupabaseClient<Database>,
  collectionId: string,
  rules: CollectionRules,
  limit: number
): Promise<string[]> {
  const bounds = ruleReceivedBounds(rules);
  let query = admin
    .from("collection_matches")
    .select("email_id")
    .eq("collection_id", collectionId);
  if (bounds.gte) query = query.gte("received_at", bounds.gte);
  if (bounds.lt) query = query.lt("received_at", bounds.lt);
  if (bounds.lte) query = query.lte("received_at", bounds.lte);

  const { data, error } = await query
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => row.email_id);
}

export type CollectionMatchTotals = { emails: number; brands: number };

/**
 * Exact totals for a smart collection within its scope / window, counting
 * duplicate sends once like the grid does. The pages only render the
 * newest RULE_EVAL_LIMIT emails, so the count can't come from them.
 */
async function loadMatchTotals(
  admin: SupabaseClient<Database>,
  collectionId: string,
  rules: CollectionRules
): Promise<CollectionMatchTotals> {
  const bounds = ruleReceivedBounds(rules);
  const { data, error } = await admin.rpc("collection_match_totals", {
    p_collection_id: collectionId,
    p_gte: bounds.gte,
    p_lt: bounds.lt,
    p_lte: bounds.lte
  });
  if (error) throw error;
  const row = data?.[0];
  return { emails: row?.emails ?? 0, brands: row?.brands ?? 0 };
}

/**
 * Ids of stored matches ingested after `createdAfter`, newest first, for
 * the new-match alert emails. Catches the collection up first. Returns
 * null while the collection is still building, so the caller can fall
 * back to evaluating the rule directly.
 */
export async function matchedEmailIdsCreatedAfter(
  admin: SupabaseClient<Database>,
  collectionId: string,
  rules: CollectionRules,
  createdAfter: string,
  limit: number
): Promise<string[] | null> {
  const build = await ensureCollectionMatches(admin, collectionId, rules, {
    catchUp: true
  });
  if (build) return null;

  const bounds = ruleReceivedBounds(rules);
  let query = admin
    .from("collection_matches")
    .select("email_id")
    .eq("collection_id", collectionId)
    .gt("email_created_at", createdAfter);
  if (bounds.gte) query = query.gte("received_at", bounds.gte);
  if (bounds.lt) query = query.lt("received_at", bounds.lt);
  if (bounds.lte) query = query.lte("received_at", bounds.lte);

  const { data, error } = await query
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => row.email_id);
}

/**
 * Build progress for one collection, or null when it has no running
 * build. Nudges a stalled build back into motion, so watching the page
 * keeps it going even if the cron worker is late.
 */
export async function getCollectionMatchBuild(
  admin: SupabaseClient<Database>,
  collectionId: string
): Promise<CollectionMatchBuild | null> {
  const build = await readMatchBuild(admin, collectionId);
  if (!build || build.status !== "building") return null;
  if (Date.now() - new Date(build.updated_at).getTime() > STALLED_BUILD_MS) {
    scheduleMatchBuild(collectionId);
  }
  return buildSnapshot(build);
}

/**
 * The background worker: starts builds for smart collections that have
 * none yet, then advances running builds round robin until the budget is
 * spent. Safe to run concurrently (each chunk locks its build row with
 * SKIP LOCKED, so two workers never process the same collection at once).
 */
export async function runCollectionMatchWorker(options: {
  budgetMs: number;
  /** Limit the pass to these collections (a build kicked by a request). */
  collectionIds?: string[];
}): Promise<{ started: number; advanced: number; finished: number }> {
  const admin = getSupabaseAdmin();
  const deadline = Date.now() + options.budgetMs;
  const summary = { started: 0, advanced: 0, finished: 0 };

  if (!options.collectionIds) {
    const { data: missing, error } = await admin.rpc(
      "collections_missing_match_build",
      { p_limit: 20 }
    );
    if (error) throw error;
    for (const row of missing ?? []) {
      const rules = safeParseStoredRules(row.rules);
      if (!rules || rules.conditions.length === 0) continue;
      await resetCollectionMatches(admin, row.id, ruleMatchKey(rules));
      summary.started += 1;
    }
  }

  // Without explicit ids: running builds, then built collections that are
  // behind, of collections that aren't dormant. A request names its
  // collection explicitly, so a dormant one that's just been opened still
  // gets its after() pass.
  let targetIds = options.collectionIds;
  if (!targetIds) {
    const { data, error } = await admin.rpc("collection_match_builds_due", {
      p_limit: 50
    });
    if (error) throw error;
    targetIds = (data ?? []).map((row) => row.collection_id);
  }
  if (targetIds.length === 0) return summary;

  const { data: rows, error: rowsError } = await admin
    .from("collections")
    .select("id, rules")
    .in("id", targetIds);
  if (rowsError) throw rowsError;

  let active = (rows ?? []).flatMap((row) => {
    const rules = safeParseStoredRules(row.rules);
    return rules && rules.conditions.length > 0 ? [{ id: row.id, rules }] : [];
  });

  // Round robin in short slices so one huge build can't starve the rest.
  while (active.length > 0 && Date.now() < deadline) {
    const next: typeof active = [];
    for (const target of active) {
      if (Date.now() >= deadline) {
        next.push(target);
        continue;
      }
      try {
        const outcome = await advanceCollectionMatches(
          admin,
          target.id,
          target.rules,
          Math.min(deadline, Date.now() + 5_000),
          // Matches for new emails in an already built collection light
          // the sidebar dot.
          { flagNew: true }
        );
        summary.advanced += 1;
        if (outcome === "building") {
          next.push(target);
        } else if (outcome === "ready") {
          summary.finished += 1;
        } else if (outcome === "stale" || outcome === "missing") {
          // Rules changed after this pass loaded them: re-read and
          // restart against what's saved now.
          const { data: fresh } = await admin
            .from("collections")
            .select("rules")
            .eq("id", target.id)
            .maybeSingle();
          const rules = safeParseStoredRules(fresh?.rules);
          await resetCollectionMatches(
            admin,
            target.id,
            rules && rules.conditions.length > 0 ? ruleMatchKey(rules) : null
          );
          if (rules && rules.conditions.length > 0) {
            next.push({ id: target.id, rules });
          }
        }
        // busy: another worker has it this round.
      } catch (err) {
        console.error("Collection match build step failed", {
          collectionId: target.id,
          err
        });
      }
    }
    active = next;
  }
  return summary;
}

/** One-to-one embeds come back as an object (or, defensively, an array). */
function embeddedBuildStatus(
  value: { status: string } | { status: string }[] | null | undefined
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0]?.status ?? null;
  return value.status;
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
  /** Test this one email only (a primary-key lookup whatever the rules). */
  emailId?: string;
  limit?: number;
};

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
  if (options?.emailId) {
    query = query.eq("id", options.emailId);
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
          query = query.or(buildSearchOrClause(filter.matcher, filter.brandIds));
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
  | { type: "search"; matcher: SearchMatcher; brandIds: string[] };

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
        const matcher = buildSearchMatcher(cond.value);
        if (!matcher) {
          if (rules.combinator === "AND") return "no_match";
          break;
        }
        const brandIds = await lookupCompanyIdsByName(client, matcher);
        filters.push({ type: "search", matcher, brandIds });
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
        parts.push(...buildSearchOrParts(filter.matcher, filter.brandIds));
        break;
    }
  }
  return parts;
}

function buildSearchOrParts(matcher: SearchMatcher, brandIds: string[]): string[] {
  const parts = [`search_text.ilike.${matcherValue(matcher, "*")}`];
  const safe = brandIds.filter((id) => UUID_PATTERN.test(id));
  if (safe.length > 0) {
    parts.push(`company_id.in.(${safe.join(",")})`);
  }
  return parts;
}

function buildSearchOrClause(matcher: SearchMatcher, brandIds: string[]): string {
  return buildSearchOrParts(matcher, brandIds).join(",");
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
  const rows = await fetchAllRows((from, to) =>
    client
      .from("companies")
      .select("id")
      .overlaps("markets", markets)
      .order("id")
      .range(from, to)
  );
  return rows.map((row) => row.id);
}

async function lookupCompanyIdsByName(
  client: SupabaseClient<Database>,
  matcher: SearchMatcher
): Promise<string[]> {
  const { data, error } = await client
    .from("companies")
    .select("id")
    .filter("name", "imatch", matcher.nameRegex)
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
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
         companies(id, slug, name, domain, markets, logo_storage_path, logo_source)
       )`
    )
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false });

  if (error) throw error;
  return embeddedRowsToCards(data ?? []);
}

/**
 * Cards from rows that embed `captured_emails` (manual membership rows
 * and stored smart-collection matches share the shape), with signed logos.
 */
async function embeddedRowsToCards(
  data: { captured_emails: EmailField }[]
): Promise<ExploreEmailCard[]> {
  // Collapse list-copies of multi-segment sends to one card, mirroring
  // Explore's `duplicate_of IS NULL` filter. Membership rows store literal
  // email ids (which may be duplicate copies, not the canonical), so we
  // group in memory rather than filtering in SQL.
  const rows = collapseDuplicateRows(data, (row) =>
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
      logo_source?: string | null;
    }
  | Array<{
      id: string;
      slug?: string | null;
      name: string;
      domain?: string | null;
      markets?: string[] | null;
      logo_storage_path?: string | null;
      logo_source?: string | null;
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
    preheader: cleanPreheaderText(email.preheader),
    companyId: company?.id ?? null,
    companySlug: company?.slug ?? null,
    companyName: company?.name ?? "Unknown",
    companyDomain: company?.domain ?? null,
    companyMarkets: pickCompanyMarkets(company),
    companyLogoUrl: resolveBrandLogo(
      logoPath ? signed[logoPath] ?? null : null,
      company?.logo_source,
      company?.domain
    ),
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
