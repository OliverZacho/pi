/**
 * Client-safe types + helpers for collection event detection.
 *
 * A collection that gathers many emails from several brands around the
 * same real-world occasion (a trade fair, a festival, Black Friday…)
 * can be analyzed by an LLM: "this collection is about 3daysofdesign,
 * June 10–12". The detection itself lives in `lib/collection-event.ts`
 * (server-only — it calls Anthropic); this module holds everything the
 * browser also needs: the cached-payload shape, the eligibility
 * heuristic that decides when to even ask the model, and a defensive
 * parser for the `collections.event_detection` jsonb column.
 */

export const CAMPAIGN_PHASES = [
  "save_the_date",
  "programme",
  "reminder",
  "day_of",
  "wrap_up",
  "other"
] as const;

export type CampaignPhase = (typeof CAMPAIGN_PHASES)[number];

export const CAMPAIGN_PHASE_LABELS: Record<CampaignPhase, string> = {
  save_the_date: "Save the date",
  programme: "Programme reveal",
  reminder: "Reminder",
  day_of: "Doors open",
  wrap_up: "Wrap-up",
  other: "Other"
};

export const COLLECTION_EVENT_KINDS = [
  "trade_fair",
  "festival",
  "conference",
  "sports",
  "sale_period",
  "product_drop",
  "other"
] as const;

export type CollectionEventKind = (typeof COLLECTION_EVENT_KINDS)[number];

export type CollectionDetectedEvent = {
  /** Canonical event name, e.g. "3daysofdesign". */
  name: string;
  /** ISO date (YYYY-MM-DD) the event starts, or null when unknown. */
  startDate: string | null;
  /** ISO date the event ends; null for single-day or unknown. */
  endDate: string | null;
  location: string | null;
  kind: CollectionEventKind;
  /** Model confidence 0–1 that this collection is about this event. */
  confidence: number;
  /** One ready-to-show sentence for the banner. */
  userMessage: string;
};

/**
 * One detected event together with the slice of the collection that
 * belongs to it. A collection that mixes two occasions (say 3daysofdesign
 * and Father's Day) yields one of these per occasion, each owning only its
 * own emails so the insights figures never blend the two.
 */
export type CollectionEventWithEmails = CollectionDetectedEvent & {
  /** Ids of the emails the model assigned to this event. */
  emailIds: string[];
  /** email id → campaign phase, scoped to this event's emails. */
  phases: Record<string, CampaignPhase>;
};

export type CollectionEventDetection = {
  version: 1;
  /** `no_event` is cached too, so we don't re-ask on every page view. */
  status: "detected" | "no_event";
  detectedAt: string;
  /** Email count when the model ran — used to invalidate stale results. */
  emailCountAtDetection: number;
  model: string;
  /**
   * Banner state: `null` = detection ran but the user hasn't responded,
   * `true` = confirmed (insights visible), `false` = dismissed.
   */
  confirmed: boolean | null;
  /**
   * The most prevalent event — kept for the single-event banner/summary
   * and for back-compat with rows written before multi-event support.
   * Equals `events[0]` when `events` is present.
   */
  event: CollectionDetectedEvent | null;
  /**
   * email id → campaign phase across the whole collection (the union of
   * every event's phases). Back-compat: the single-event insights card
   * reads this directly.
   */
  phases: Record<string, CampaignPhase>;
  /**
   * Every distinct event the collection covers, most prevalent first.
   * Absent on legacy rows (treated as the single `event` above). Two or
   * more entries drives the tabbed insights view.
   */
  events?: CollectionEventWithEmails[];
};

// ---------- Eligibility heuristic ----------

export const EVENT_DETECTION_MIN_EMAILS = 8;
export const EVENT_DETECTION_MIN_BRANDS = 3;
/** Share of emails categorised event/seasonal needed to bother the LLM. */
const EVENT_CATEGORY_SHARE = 0.4;
/**
 * A cached result goes stale once the collection has grown by this many
 * emails since detection ran (rule-based collections keep collecting).
 */
export const EVENT_DETECTION_STALE_AFTER_NEW_EMAILS = 10;

export type EventDetectionEligibilityInput = {
  category: string;
  companyName: string;
};

/**
 * Cheap pre-filter so we only spend an LLM call on collections that
 * plausibly revolve around one occasion: enough emails, several brands,
 * and a meaningful share of event-ish categories. Deliberately loose —
 * the model makes the real call (and can answer "no_event", which we
 * also cache).
 */
export function isEligibleForEventDetection(
  emails: EventDetectionEligibilityInput[]
): boolean {
  if (emails.length < EVENT_DETECTION_MIN_EMAILS) return false;

  const brands = new Set<string>();
  let eventish = 0;
  for (const email of emails) {
    brands.add(email.companyName);
    if (email.category === "event" || email.category === "seasonal") {
      eventish += 1;
    }
  }

  if (brands.size < EVENT_DETECTION_MIN_BRANDS) return false;
  return eventish / emails.length >= EVENT_CATEGORY_SHARE;
}

// ---------- Discount figure eligibility ----------

/**
 * The "how much each brand discounts" figure only earns its place when
 * discounting is the collection's throughline: a vast majority of emails
 * carry a parsed % off, and at least two brands discount so there's
 * something to compare. Shared so the server can decide whether the
 * (whole-archive) 12-month benchmark lookup is even worth running before
 * the client renders the figure.
 */
export const DISCOUNT_FIGURE_MIN_SHARE = 0.7;
export const DISCOUNT_FIGURE_MIN_BRANDS = 2;

export type DiscountEligibilityInput = {
  discountPercent: number | null;
  companyName: string;
};

export function isDiscountFigureEligible(
  emails: DiscountEligibilityInput[]
): boolean {
  if (emails.length === 0) return false;
  let withDiscount = 0;
  const brands = new Set<string>();
  for (const email of emails) {
    const pct = email.discountPercent;
    if (pct !== null && Number.isFinite(pct) && pct > 0) {
      withDiscount += 1;
      brands.add(email.companyName);
    }
  }
  if (brands.size < DISCOUNT_FIGURE_MIN_BRANDS) return false;
  return withDiscount / emails.length >= DISCOUNT_FIGURE_MIN_SHARE;
}

/**
 * True when a cached detection should be re-run because the collection
 * has grown well past the snapshot the model saw.
 */
export function isEventDetectionStale(
  detection: CollectionEventDetection,
  currentEmailCount: number
): boolean {
  return (
    currentEmailCount - detection.emailCountAtDetection >=
    EVENT_DETECTION_STALE_AFTER_NEW_EMAILS
  );
}

// ---------- Defensive parse ----------

const PHASE_LOOKUP = new Set<string>(CAMPAIGN_PHASES);
const KIND_LOOKUP = new Set<string>(COLLECTION_EVENT_KINDS);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Defensive read of the `event_detection` column — same philosophy as
 * `safeParseStoredRules`: the column is plain jsonb, so a corrupted row
 * must degrade to "no detection yet" rather than crash the page.
 */
export function safeParseEventDetection(
  value: unknown
): CollectionEventDetection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;

  if (obj.version !== 1) return null;
  if (obj.status !== "detected" && obj.status !== "no_event") return null;
  if (typeof obj.detectedAt !== "string") return null;
  if (typeof obj.emailCountAtDetection !== "number") return null;
  if (typeof obj.model !== "string") return null;
  if (obj.confirmed !== null && typeof obj.confirmed !== "boolean") return null;

  let event: CollectionDetectedEvent | null = null;
  if (obj.status === "detected") {
    event = parseDetectedEvent(obj.event);
    // A "detected" row without a usable event is corrupt — degrade to null.
    if (!event) return null;
  }

  const phases = parsePhaseMap(obj.phases);

  // Optional multi-event array. Each entry is a full event plus the slice
  // of emails assigned to it; a malformed entry is dropped rather than
  // failing the whole parse (legacy rows simply omit the field).
  let events: CollectionEventWithEmails[] | undefined;
  if (Array.isArray(obj.events)) {
    const parsed: CollectionEventWithEmails[] = [];
    for (const raw of obj.events) {
      const detected = parseDetectedEvent(raw);
      if (!detected) continue;
      const e = raw as Record<string, unknown>;
      const emailIds = Array.isArray(e.emailIds)
        ? e.emailIds.filter((id): id is string => typeof id === "string")
        : [];
      parsed.push({ ...detected, emailIds, phases: parsePhaseMap(e.phases) });
    }
    if (parsed.length > 0) events = parsed;
  }

  return {
    version: 1,
    status: obj.status,
    detectedAt: obj.detectedAt,
    emailCountAtDetection: obj.emailCountAtDetection,
    model: obj.model,
    confirmed: obj.confirmed as boolean | null,
    event,
    phases,
    ...(events ? { events } : {})
  };
}

/** Parse a single detected-event object, or null when it's unusable. */
function parseDetectedEvent(raw: unknown): CollectionDetectedEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.name !== "string" || e.name.length === 0) return null;
  if (typeof e.userMessage !== "string") return null;
  return {
    name: e.name,
    startDate: parseIsoDate(e.startDate),
    endDate: parseIsoDate(e.endDate),
    location: typeof e.location === "string" ? e.location : null,
    kind: KIND_LOOKUP.has(String(e.kind))
      ? (e.kind as CollectionEventKind)
      : "other",
    confidence:
      typeof e.confidence === "number"
        ? Math.max(0, Math.min(1, e.confidence))
        : 0,
    userMessage: e.userMessage
  };
}

function parsePhaseMap(value: unknown): Record<string, CampaignPhase> {
  const phases: Record<string, CampaignPhase> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, phase] of Object.entries(value as Record<string, unknown>)) {
      if (typeof phase === "string" && PHASE_LOOKUP.has(phase)) {
        phases[id] = phase as CampaignPhase;
      }
    }
  }
  return phases;
}

/**
 * Normalises a detection into the list of events to render. Multi-event
 * rows return their `events`; a single-event (or legacy) row returns one
 * synthesised entry that owns the supplied email ids — so the caller can
 * treat both shapes uniformly.
 */
export function resolveCollectionEvents(
  detection: CollectionEventDetection,
  allEmailIds: string[]
): CollectionEventWithEmails[] {
  if (detection.status !== "detected") return [];
  if (detection.events && detection.events.length > 0) return detection.events;
  if (!detection.event) return [];
  return [
    { ...detection.event, emailIds: allEmailIds, phases: detection.phases }
  ];
}

function parseIsoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value) ? value : null;
}
