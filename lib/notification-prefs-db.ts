import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import {
  NOTIFICATION_PREFS_KEY,
  defaultNotificationPrefs,
  sanitizeNotificationPrefs,
  type NotificationPrefs
} from "./notification-prefs";

/**
 * Read/write helpers for notification preferences on the generic
 * `user_prefs` table (one jsonb value under
 * {@link NOTIFICATION_PREFS_KEY}). Takes the user-bound Supabase client
 * so RLS scopes access to `auth.uid()`; callers handle authentication.
 *
 * Reads never throw: a missing row, a query error or a malformed value
 * all degrade to the defaults so a broken pref can't take the settings
 * page down with it.
 */

export async function getNotificationPrefs(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<NotificationPrefs> {
  try {
    const { data, error } = await supabase
      .from("user_prefs")
      .select("value")
      .eq("user_id", userId)
      .eq("key", NOTIFICATION_PREFS_KEY)
      .maybeSingle();

    if (error || !data) return defaultNotificationPrefs();
    return sanitizeNotificationPrefs(data.value);
  } catch (err) {
    console.error("Failed to load notification prefs", err);
    return defaultNotificationPrefs();
  }
}

export async function saveNotificationPrefs(
  supabase: SupabaseClient<Database>,
  userId: string,
  /** Untrusted — sanitized before the write (unknown keys/cadences dropped). */
  prefs: unknown
): Promise<NotificationPrefs> {
  const clean = sanitizeNotificationPrefs(prefs);
  const { error } = await supabase.from("user_prefs").upsert(
    {
      user_id: userId,
      key: NOTIFICATION_PREFS_KEY,
      value: clean,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id,key" }
  );
  if (error) throw error;
  return clean;
}
