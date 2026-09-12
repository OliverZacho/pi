import { normalizeHost } from "./logo-dev";
import { MAX_BRAND_REQUEST_FIELD } from "./brand-requests-db";

/**
 * Pure domain logic for the new-signup onboarding modal (role → categories →
 * follow brands). No DB access — the API route feeds it the raw request body
 * and acts on the validated payload, and the unit tests exercise it directly.
 */

export const ONBOARDING_ROLES = [
  "brand_marketer",
  "agency_freelancer",
  "founder",
  "creative",
  "exploring"
] as const;

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

export const ONBOARDING_ROLE_LABELS: Record<OnboardingRole, string> = {
  brand_marketer: "Marketer at a brand",
  agency_freelancer: "Agency or freelancer",
  founder: "Founder running my own shop",
  creative: "Designer or copywriter",
  exploring: "Just exploring"
};

/** Roles that get the optional "Which brand do you work on?" follow-up. */
export const ROLES_WITH_OWN_BRAND: readonly OnboardingRole[] = [
  "brand_marketer",
  "founder"
];

export const MIN_ONBOARDING_FOLLOWS = 3;
export const MAX_ONBOARDING_FOLLOWS = 20;

/** Sanity caps on the free-text-ish inputs so a hostile client can't
 *  balloon the profile row. Categories come from the server-provided facet
 *  list, so these are generous. */
const MAX_CATEGORIES = 30;
const MAX_CATEGORY_LENGTH = 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OnboardingRequestPick = {
  name: string;
  /** Normalized registrable host, e.g. "ganni.com". */
  domain: string;
};

/** Modal step (1 role, 2 categories, 3 follows) a skip was taken from. */
export type OnboardingSkippedStep = 1 | 2 | 3;

/**
 * Where an account stands with the modal, as the admin panel reports it:
 * finished all 3 steps, hit "Skip for now" (with the step they left from),
 * or hasn't answered yet.
 */
export type OnboardingOutcome =
  | { state: "completed" }
  | { state: "skipped"; step: number | null }
  | { state: "pending" };

export function onboardingOutcomeOf(profile: {
  onboarding_completed_at: string | null;
  onboarding_skipped_step: number | null;
}): OnboardingOutcome {
  if (!profile.onboarding_completed_at) return { state: "pending" };
  if (profile.onboarding_skipped_step !== null) {
    return { state: "skipped", step: profile.onboarding_skipped_step };
  }
  return { state: "completed" };
}

export type OnboardingCompletion = {
  skipped: boolean;
  /**
   * Which step the user skipped from; null for a completed onboarding. Sent
   * by the modal, and otherwise inferred from the answers left behind (a
   * role is required to leave step 1, a category to leave step 2).
   */
  skippedStep: OnboardingSkippedStep | null;
  role: OnboardingRole | null;
  categories: string[];
  ownBrandDomain: string | null;
  /** Tracked company ids to follow. */
  follows: string[];
  /** Untracked picks that become brand_requests rows. */
  requests: OnboardingRequestPick[];
};

export type ParseResult =
  | { ok: true; payload: OnboardingCompletion }
  | { ok: false; error: string };

function isRole(value: unknown): value is OnboardingRole {
  return (
    typeof value === "string" &&
    (ONBOARDING_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Validates the POST /api/onboarding/complete body. Everything is optional
 * on the skip path (partial answers are kept); a non-skip completion must
 * carry {@link MIN_ONBOARDING_FOLLOWS}–{@link MAX_ONBOARDING_FOLLOWS} total
 * picks across follows + requests. Follow ids are still re-verified against
 * `companies` by the route — this only guards shape and bounds.
 */
export function parseOnboardingCompletion(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid body" };
  }
  const input = body as Record<string, unknown>;

  const skipped = input.skipped === true;

  let role: OnboardingRole | null = null;
  if (input.role != null) {
    if (!isRole(input.role)) return { ok: false, error: "Unknown role" };
    role = input.role;
  }

  const categories: string[] = [];
  if (input.categories != null) {
    if (!Array.isArray(input.categories)) {
      return { ok: false, error: "Invalid categories" };
    }
    for (const raw of input.categories) {
      if (typeof raw !== "string") return { ok: false, error: "Invalid categories" };
      const value = raw.trim().toLowerCase();
      if (!value || value.length > MAX_CATEGORY_LENGTH) continue;
      if (!categories.includes(value)) categories.push(value);
      if (categories.length >= MAX_CATEGORIES) break;
    }
  }

  let skippedStep: OnboardingSkippedStep | null = null;
  if (skipped) {
    if (input.skippedStep != null) {
      if (
        input.skippedStep !== 1 &&
        input.skippedStep !== 2 &&
        input.skippedStep !== 3
      ) {
        return { ok: false, error: "Invalid skipped step" };
      }
      skippedStep = input.skippedStep;
    } else {
      skippedStep = role === null ? 1 : categories.length === 0 ? 2 : 3;
    }
  }

  let ownBrandDomain: string | null = null;
  if (input.ownBrandDomain != null) {
    if (typeof input.ownBrandDomain !== "string") {
      return { ok: false, error: "Invalid own brand" };
    }
    ownBrandDomain = normalizeHost(input.ownBrandDomain);
    if (input.ownBrandDomain.trim() && !ownBrandDomain) {
      return { ok: false, error: "Invalid own brand" };
    }
  }

  const follows: string[] = [];
  if (input.follows != null) {
    if (!Array.isArray(input.follows)) {
      return { ok: false, error: "Invalid follows" };
    }
    for (const raw of input.follows) {
      if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
        return { ok: false, error: "Invalid follows" };
      }
      const value = raw.toLowerCase();
      if (!follows.includes(value)) follows.push(value);
    }
  }

  const requests: OnboardingRequestPick[] = [];
  if (input.requests != null) {
    if (!Array.isArray(input.requests)) {
      return { ok: false, error: "Invalid requests" };
    }
    for (const raw of input.requests) {
      if (typeof raw !== "object" || raw === null) {
        return { ok: false, error: "Invalid requests" };
      }
      const { name, domain } = raw as { name?: unknown; domain?: unknown };
      if (typeof name !== "string" || typeof domain !== "string") {
        return { ok: false, error: "Invalid requests" };
      }
      const trimmedName = name.trim();
      const host = normalizeHost(domain);
      if (
        !trimmedName ||
        trimmedName.length > MAX_BRAND_REQUEST_FIELD ||
        !host ||
        host.length > MAX_BRAND_REQUEST_FIELD
      ) {
        return { ok: false, error: "Invalid requests" };
      }
      if (!requests.some((r) => r.domain === host)) {
        requests.push({ name: trimmedName, domain: host });
      }
    }
  }

  const totalPicks = follows.length + requests.length;
  if (!skipped) {
    if (totalPicks < MIN_ONBOARDING_FOLLOWS) {
      return {
        ok: false,
        error: `Pick at least ${MIN_ONBOARDING_FOLLOWS} brands`
      };
    }
    if (totalPicks > MAX_ONBOARDING_FOLLOWS) {
      return {
        ok: false,
        error: `Pick at most ${MAX_ONBOARDING_FOLLOWS} brands`
      };
    }
  }

  return {
    ok: true,
    payload: {
      skipped,
      skippedStep,
      role,
      categories,
      ownBrandDomain,
      follows,
      requests
    }
  };
}
