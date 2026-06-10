import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/**
 * Helpers for the Settings User tab.
 *
 * `user_profiles` is kept in sync with `auth.users` by a DB trigger, so a
 * row always exists for a signed-in user. All calls here use the
 * request-bound session client — RLS scopes reads/writes to the caller's
 * own row.
 */

export const MAX_FULL_NAME_LENGTH = 120;

export type Profile = {
  fullName: string | null;
  email: string;
};

export async function getProfile(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("full_name, email")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return { fullName: data.full_name, email: data.email };
}

export async function updateFullName(
  supabase: SupabaseClient<Database>,
  userId: string,
  fullName: string
): Promise<Profile> {
  const trimmed = fullName.trim();
  const { data, error } = await supabase
    .from("user_profiles")
    .update({ full_name: trimmed, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("full_name, email")
    .single();

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`);
  }

  return { fullName: data.full_name, email: data.email };
}

/**
 * Whether the caller's auth user has a password set. Magic-link/OAuth
 * signups don't, and the Settings password section switches between
 * "Set a password" and "Change password" on this flag.
 */
export async function userHasPassword(
  supabase: SupabaseClient<Database>
): Promise<boolean> {
  const { data, error } = await supabase.rpc("user_has_password");

  if (error) {
    throw new Error(`Failed to check password state: ${error.message}`);
  }

  return data === true;
}
