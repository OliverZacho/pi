import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getResend } from "@/lib/resend";
import { getBrandPageData, type BrandPageData } from "@/lib/brand-db";
import {
  NOTIFICATION_PREFS_KEY,
  sanitizeNotificationPrefs,
  type DigestCadence
} from "@/lib/notification-prefs";
import { buildDigestModel } from "./build";
import { renderDigestEmail } from "./render";

/**
 * The editorial digest job. For one cadence (daily / weekly / monthly):
 *
 *   1. Resolve the audience — entitled subscribers whose "new email"
 *      preference is this cadence. Unpaid users are excluded here, so the
 *      digest stays a paid feature regardless of what they set.
 *   2. Build each followed brand's page data once and share it across
 *      every user who follows that brand (the only real cost center).
 *   3. Per user, window emails since their last successful send, compose
 *      the model, and send. A truly empty window is suppressed; a quiet
 *      window with sends but no signal falls back to plain stats.
 *
 * Runs as the service role (RLS bypassed) — it's a trusted server job
 * invoked only by the cron route behind a shared secret.
 */

const DIGEST_FROM = process.env.DIGEST_FROM ?? "Pirol <onboarding@resend.dev>";
const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://pirol.app";

const CADENCE_MS: Record<DigestCadence, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000
};

/**
 * Minimum gap before the same user is sent another digest of this
 * cadence — guards against a double cron fire. A touch under the cadence
 * length so a job that runs a little early never skips a legitimate send.
 */
const MIN_RESEND_MS: Record<DigestCadence, number> = {
  daily: 20 * 3_600_000,
  weekly: 6 * 86_400_000,
  monthly: 27 * 86_400_000
};

export type DigestRunSummary = {
  cadence: DigestCadence;
  eligible: number;
  sent: number;
  skippedEmpty: number;
  skippedRecent: number;
  errors: number;
};

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** Entitled = active/trialing subscription (not lapsed) OR admin. */
async function entitledUserIds(admin: SupabaseAdmin): Promise<Set<string>> {
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

/** Entitled users whose "new email" preference equals this cadence. */
async function resolveAudience(
  admin: SupabaseAdmin,
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
    if (sanitizeNotificationPrefs(row.value).newEmail === cadence) {
      out.push(row.user_id);
    }
  }
  return out;
}

async function loadBrandData(
  admin: SupabaseAdmin,
  brandIds: string[]
): Promise<Map<string, BrandPageData>> {
  const map = new Map<string, BrandPageData>();
  // Build each unique brand once; modest concurrency keeps the storage /
  // query fan-out civil without serializing the whole run.
  const CONCURRENCY = 6;
  for (let i = 0; i < brandIds.length; i += CONCURRENCY) {
    const slice = brandIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          return [id, await getBrandPageData(admin, id)] as const;
        } catch (err) {
          console.error(`digest: failed to load brand ${id}`, err);
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

async function windowStartFor(
  admin: SupabaseAdmin,
  userId: string,
  cadence: DigestCadence,
  now: Date
): Promise<{ start: Date; lastSentMs: number | null }> {
  const { data } = await admin
    .from("digest_sends")
    .select("sent_at")
    .eq("user_id", userId)
    .eq("cadence", cadence)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.sent_at) {
    const lastMs = Date.parse(data.sent_at);
    if (!Number.isNaN(lastMs)) {
      return { start: new Date(lastMs), lastSentMs: lastMs };
    }
  }
  return { start: new Date(now.getTime() - CADENCE_MS[cadence]), lastSentMs: null };
}

export async function runDigest(
  cadence: DigestCadence
): Promise<DigestRunSummary> {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const summary: DigestRunSummary = {
    cadence,
    eligible: 0,
    sent: 0,
    skippedEmpty: 0,
    skippedRecent: 0,
    errors: 0
  };

  const userIds = await resolveAudience(admin, cadence);
  summary.eligible = userIds.length;
  if (userIds.length === 0) return summary;

  const [{ data: profileRows }, { data: followRows }] = await Promise.all([
    admin.from("user_profiles").select("user_id, email").in("user_id", userIds),
    admin
      .from("brand_follows")
      .select("user_id, company_id")
      .in("user_id", userIds)
  ]);

  const emailByUser = new Map<string, string>();
  for (const row of profileRows ?? []) {
    if (row.email) emailByUser.set(row.user_id, row.email);
  }

  const brandsByUser = new Map<string, string[]>();
  const allBrandIds = new Set<string>();
  for (const row of followRows ?? []) {
    allBrandIds.add(row.company_id);
    const list = brandsByUser.get(row.user_id) ?? [];
    list.push(row.company_id);
    brandsByUser.set(row.user_id, list);
  }

  const brandData = await loadBrandData(admin, Array.from(allBrandIds));

  for (const userId of userIds) {
    const to = emailByUser.get(userId);
    const brandIds = brandsByUser.get(userId) ?? [];
    if (!to || brandIds.length === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const { start, lastSentMs } = await windowStartFor(
      admin,
      userId,
      cadence,
      now
    );
    if (lastSentMs !== null && now.getTime() - lastSentMs < MIN_RESEND_MS[cadence]) {
      summary.skippedRecent += 1;
      continue;
    }

    const brands = brandIds
      .map((id) => brandData.get(id))
      .filter((b): b is BrandPageData => Boolean(b));
    if (brands.length === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const model = buildDigestModel({
      cadence,
      windowStart: start,
      windowEnd: now,
      brands
    });
    // True-empty window: nothing arrived. Suppress to protect inbox trust.
    if (model.emailCount === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const { subject, html, text } = renderDigestEmail(model);
    try {
      const { data: sendData, error } = await getResend().emails.send({
        from: DIGEST_FROM,
        to,
        subject,
        html,
        text,
        headers: {
          "List-Unsubscribe": `<${APP_URL}/settings/notifications>`
        }
      });
      if (error) throw error;

      await admin.from("digest_sends").insert({
        user_id: userId,
        cadence,
        window_start: start.toISOString(),
        window_end: now.toISOString(),
        email_count: model.emailCount,
        brand_count: model.brandCount,
        resend_id: sendData?.id ?? null
      });
      summary.sent += 1;
    } catch (err) {
      console.error(`digest: send failed for ${userId}`, err);
      summary.errors += 1;
    }
  }

  return summary;
}
