/**
 * Registry + preference plumbing for the per-user notification settings
 * (the Settings → Notifications screen).
 *
 * Each notification type carries a delivery cadence. For "new email from
 * a brand you follow", the digest cadences (daily / weekly / monthly)
 * drive the editorial digest job; `instant` is handled by the live
 * capture path and `off` suppresses entirely.
 *
 * Stored per user in `user_prefs` under {@link NOTIFICATION_PREFS_KEY}.
 * Client-safe: no Supabase imports, just the registry and the sanitizer
 * shared by the API route, the settings UI and the digest job.
 */

export const NOTIFICATION_PREFS_KEY = "notification_preferences";

export const NOTIFICATION_CADENCES = [
  "instant",
  "daily",
  "weekly",
  "monthly",
  "off"
] as const;

export type NotificationCadence = (typeof NOTIFICATION_CADENCES)[number];

/** Cadences the digest job acts on (everything except instant / off). */
export const DIGEST_CADENCES = ["daily", "weekly", "monthly"] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];

export function isDigestCadence(value: string): value is DigestCadence {
  return (DIGEST_CADENCES as readonly string[]).includes(value);
}

/**
 * One entry per notification type, with its out-of-the-box cadence.
 * Defaults mirror the Settings screen: a brand's new emails arrive
 * instantly, the analytical signals are batched.
 */
export const NOTIFICATION_TYPES = [
  { id: "newEmail", default: "instant" },
  { id: "unusualActivity", default: "daily" },
  { id: "seasonalRunup", default: "weekly" },
  { id: "smartCollection", default: "daily" }
] as const satisfies readonly { id: string; default: NotificationCadence }[];

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]["id"];

export type NotificationPrefs = Record<NotificationType, NotificationCadence>;

const KNOWN_CADENCES = new Set<string>(NOTIFICATION_CADENCES);

export function defaultNotificationPrefs(): NotificationPrefs {
  const out = {} as NotificationPrefs;
  for (const type of NOTIFICATION_TYPES) {
    out[type.id] = type.default;
  }
  return out;
}

/**
 * Coerces whatever is stored (or PUT by a client) into a valid prefs
 * object: every known type gets a valid cadence, unknown keys are
 * dropped, and a missing or malformed cadence falls back to that type's
 * default rather than disappearing.
 */
export function sanitizeNotificationPrefs(value: unknown): NotificationPrefs {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const out = defaultNotificationPrefs();
  for (const type of NOTIFICATION_TYPES) {
    const candidate = raw[type.id];
    if (typeof candidate === "string" && KNOWN_CADENCES.has(candidate)) {
      out[type.id] = candidate as NotificationCadence;
    }
  }
  return out;
}
