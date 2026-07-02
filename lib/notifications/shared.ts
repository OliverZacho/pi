import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getBrandPageData, type BrandPageData } from "@/lib/brand-db";
import {
  NOTIFICATION_PREFS_KEY,
  sanitizeNotificationPrefs,
  type NotificationType,
  type DigestCadence
} from "@/lib/notification-prefs";

/**
 * Shared plumbing for the scheduled notification jobs (digest, seasonal
 * run-up, …). Each job runs as the service role behind the cron
 * dispatcher; these helpers resolve the paid audience and build the
 * brand data every job reads.
 */

export type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Everything the per-type notification jobs share for one cadence tick:
 * the admin client, the cadence, and the brand data / follows / emails
 * built once for the whole entitled base so adding notification types
 * doesn't multiply DB work.
 */
export type NotificationContext = {
  admin: SupabaseAdmin;
  cadence: DigestCadence;
  brandData: Map<string, BrandPageData>;
  followsByUser: Map<string, string[]>;
  emailByUser: Map<string, string>;
};

/** "From" address for all notification mail (paid feature, verified domain). */
export const NOTIFICATION_FROM =
  process.env.DIGEST_FROM ?? "Pirol <onboarding@resend.dev>";

export const CADENCE_MS: Record<DigestCadence, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000
};

/** Entitled = active/trialing subscription (not lapsed) OR admin. */
export async function entitledUserIds(admin: SupabaseAdmin): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const [subs, admins] = await Promise.all([
    admin
      .from("subscriptions")
      .select("user_id, status, current_period_end")
      .in("status", ["active", "trialing"]),
    admin.from("admin_users").select("user_id")
  ]);

  const ids = new Set<string>();
  for (const row of subs.data ?? []) {
    if (!row.current_period_end || row.current_period_end > nowIso) {
      ids.add(row.user_id);
    }
  }
  for (const row of admins.data ?? []) ids.add(row.user_id);
  return ids;
}

/**
 * Entitled users whose preference for `type` equals this cadence. Unpaid
 * users are excluded here, so every notification stays a paid feature
 * regardless of what they set.
 */
export async function resolveAudience(
  admin: SupabaseAdmin,
  type: NotificationType,
  cadence: DigestCadence
): Promise<string[]> {
  const entitled = await entitledUserIds(admin);
  if (entitled.size === 0) return [];

  const { data: prefRows } = await admin
    .from("user_prefs")
    .select("user_id, value")
    .eq("key", NOTIFICATION_PREFS_KEY);

  const out: string[] = [];
  for (const row of prefRows ?? []) {
    if (!entitled.has(row.user_id)) continue;
    if (sanitizeNotificationPrefs(row.value)[type] === cadence) {
      out.push(row.user_id);
    }
  }
  return out;
}

/**
 * The followed-brand ids for each user in `userIds`, plus the union set,
 * in one query. Callers build brand data once for the union and share it.
 */
export async function loadFollows(
  admin: SupabaseAdmin,
  userIds: string[]
): Promise<{ byUser: Map<string, string[]>; all: Set<string> }> {
  const byUser = new Map<string, string[]>();
  const all = new Set<string>();
  if (userIds.length === 0) return { byUser, all };

  const { data } = await admin
    .from("brand_follows")
    .select("user_id, company_id")
    .in("user_id", userIds);

  for (const row of data ?? []) {
    all.add(row.company_id);
    const list = byUser.get(row.user_id) ?? [];
    list.push(row.company_id);
    byUser.set(row.user_id, list);
  }
  return { byUser, all };
}

/** Signed-in email per user id (the digest/alert recipient address). */
export async function loadEmails(
  admin: SupabaseAdmin,
  userIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const { data } = await admin
    .from("user_profiles")
    .select("user_id, email")
    .in("user_id", userIds);
  for (const row of data ?? []) {
    if (row.email) out.set(row.user_id, row.email);
  }
  return out;
}

/**
 * Assemble the shared context for one cadence tick: entitled base, their
 * follows, the brand data for every followed brand, and recipient emails.
 * Each job then filters to its own audience without re-querying.
 */
export async function buildContext(
  admin: SupabaseAdmin,
  cadence: DigestCadence
): Promise<NotificationContext> {
  const entitled = await entitledUserIds(admin);
  const userIds = [...entitled];
  const [{ byUser, all }, emailByUser] = await Promise.all([
    loadFollows(admin, userIds),
    loadEmails(admin, userIds)
  ]);
  const brandData = await loadBrandData(admin, [...all]);
  return {
    admin,
    cadence,
    brandData,
    followsByUser: byUser,
    emailByUser
  };
}

/**
 * Build each unique brand's page data once, shared across every user who
 * follows it (the only real cost center). Modest concurrency keeps the
 * storage / query fan-out civil without serializing the whole run.
 */
export async function loadBrandData(
  admin: SupabaseAdmin,
  brandIds: string[]
): Promise<Map<string, BrandPageData>> {
  const map = new Map<string, BrandPageData>();
  const CONCURRENCY = 6;
  for (let i = 0; i < brandIds.length; i += CONCURRENCY) {
    const slice = brandIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          return [id, await getBrandPageData(admin, id)] as const;
        } catch (err) {
          console.error(`notifications: failed to load brand ${id}`, err);
          return [id, null] as const;
        }
      })
    );
    for (const [id, data] of results) {
      if (data) map.set(id, data);
    }
  }
  return map;
}
