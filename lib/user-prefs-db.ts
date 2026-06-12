import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import {
  COMPARE_SECTIONS_PREF_KEY,
  defaultCompareSectionPrefs,
  sanitizeCompareSectionPrefs,
  type CompareSectionPrefs
} from "./comparison-sections";

/**
 * Read/write helpers for the generic `user_prefs` table — one jsonb
 * value per (user, key). Every function takes the user-bound Supabase
 * client so RLS scopes access to `auth.uid()`; callers are responsible
 * for authentication.
 *
 * Reads never throw for layout preferences: a missing row, a query
 * error or a malformed value all degrade to the defaults, because a
 * broken pref should never take the dashboard down with it.
 */

export async function getCompareSectionPrefs(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CompareSectionPrefs> {
  try {
    const { data, error } = await supabase
      .from("user_prefs")
      .select("value")
      .eq("user_id", userId)
      .eq("key", COMPARE_SECTIONS_PREF_KEY)
      .maybeSingle();

    if (error || !data) return defaultCompareSectionPrefs();
    return sanitizeCompareSectionPrefs(data.value);
  } catch (err) {
    console.error("Failed to load compare section prefs", err);
    return defaultCompareSectionPrefs();
  }
}

export async function saveCompareSectionPrefs(
  supabase: SupabaseClient<Database>,
  userId: string,
  /** Untrusted — sanitized before the write (unknown ids dropped). */
  prefs: unknown
): Promise<CompareSectionPrefs> {
  const clean = sanitizeCompareSectionPrefs(prefs);
  const { error } = await supabase.from("user_prefs").upsert(
    {
      user_id: userId,
      key: COMPARE_SECTIONS_PREF_KEY,
      value: clean,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id,key" }
  );
  if (error) throw error;
  return clean;
}
