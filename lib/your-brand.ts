import {
  isYourBrandInsightId,
  type YourBrandInsightId
} from "./your-brand-insights";

/**
 * Preference plumbing for the "Your brand" tab.
 *
 * Client-safe: no Supabase imports, just the pref key, the shape and the
 * sanitizer shared by the API route, the server page and the client
 * dashboard (same convention as `comparison-sections.ts`).
 *
 * `dismissed` holds insight rule ids the user has hidden ("I know, it's a
 * decision we've taken"). A dismissal is per rule and permanent until the
 * user restores it from the hidden list; rules that stop firing simply
 * disappear regardless of dismissal state. `competitorSetId` points at
 * one of the user's saved comparisons and powers the peer-based rules.
 */

export const YOUR_BRAND_PREF_KEY = "your_brand";

export type YourBrandPrefs = {
  dismissed: YourBrandInsightId[];
  competitorSetId: string | null;
};

export function defaultYourBrandPrefs(): YourBrandPrefs {
  return { dismissed: [], competitorSetId: null };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns whatever is stored (or PUT by a client) into a valid pref object:
 * unknown insight ids are dropped, duplicates collapse, and a malformed
 * set id degrades to "no comparison selected" rather than an error.
 */
export function sanitizeYourBrandPrefs(value: unknown): YourBrandPrefs {
  const raw =
    value && typeof value === "object"
      ? (value as { dismissed?: unknown; competitorSetId?: unknown })
      : {};

  const dismissed: YourBrandInsightId[] = [];
  if (Array.isArray(raw.dismissed)) {
    for (const id of raw.dismissed) {
      if (isYourBrandInsightId(id) && !dismissed.includes(id)) {
        dismissed.push(id);
      }
    }
  }

  const competitorSetId =
    typeof raw.competitorSetId === "string" && UUID_RE.test(raw.competitorSetId)
      ? raw.competitorSetId
      : null;

  return { dismissed, competitorSetId };
}
