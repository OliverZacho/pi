import "server-only";
import { getResend } from "@/lib/resend";
import type { BrandPageData } from "@/lib/brand-db";
import type { DigestCadence } from "@/lib/notification-prefs";
import {
  resolveAudience,
  NOTIFICATION_FROM,
  type NotificationContext,
  type SupabaseAdmin
} from "./shared";
import { APP_URL } from "./email-shell";
import { detectSeasonalSignals, buildSeasonalModel } from "./seasonal-build";
import { renderSeasonalEmail } from "./seasonal-render";

/**
 * The "seasonal run-up" job for one cadence. Alerts when a followed brand
 * starts teasing an upcoming seasonal event, once per (brand, event,
 * year) via a `seasonal:<event>:<year>` fingerprint in notification_alerts.
 */

const NOTIFICATION_TYPE = "seasonal_runup";
/**
 * A run-up alert fires once per occurrence. This lookback only needs to
 * outlast the run-up window so the same occurrence isn't re-alerted;
 * next year's occurrence has a different fingerprint and re-fires.
 */
const DEDUP_LOOKBACK_MS = 200 * 86_400_000;

export type SeasonalRunSummary = {
  cadence: DigestCadence;
  eligible: number;
  sent: number;
  skippedEmpty: number;
  errors: number;
};

/** Set of `${user}|${company}|${fingerprint}` already alerted this occurrence. */
async function alertedOccurrences(
  admin: SupabaseAdmin,
  userIds: string[],
  now: Date
): Promise<Set<string>> {
  const seen = new Set<string>();
  if (userIds.length === 0) return seen;
  const cutoff = new Date(now.getTime() - DEDUP_LOOKBACK_MS).toISOString();
  const { data } = await admin
    .from("notification_alerts")
    .select("user_id, company_id, kind")
    .gte("alerted_at", cutoff)
    .like("kind", "seasonal:%")
    .in("user_id", userIds);
  for (const row of data ?? []) {
    seen.add(`${row.user_id}|${row.company_id}|${row.kind}`);
  }
  return seen;
}

export async function runSeasonalRunup(
  ctx: NotificationContext
): Promise<SeasonalRunSummary> {
  const { admin, cadence, brandData, followsByUser, emailByUser } = ctx;
  const now = new Date();
  const summary: SeasonalRunSummary = {
    cadence,
    eligible: 0,
    sent: 0,
    skippedEmpty: 0,
    errors: 0
  };

  const userIds = await resolveAudience(admin, "seasonalRunup", cadence);
  summary.eligible = userIds.length;
  if (userIds.length === 0) return summary;

  const alerted = await alertedOccurrences(admin, userIds, now);

  for (const userId of userIds) {
    const to = emailByUser.get(userId);
    const brandIds = followsByUser.get(userId) ?? [];
    if (!to || brandIds.length === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const brands = brandIds
      .map((id) => brandData.get(id))
      .filter((b): b is BrandPageData => Boolean(b));

    const fresh = detectSeasonalSignals(brands, now).filter(
      (s) => !alerted.has(`${userId}|${s.companyId}|${s.fingerprint}`)
    );
    if (fresh.length === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const model = buildSeasonalModel(cadence, fresh);
    const { subject, html, text } = renderSeasonalEmail(model);
    try {
      const { data: sendData, error } = await getResend().emails.send({
        from: NOTIFICATION_FROM,
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
        notification_type: NOTIFICATION_TYPE,
        cadence,
        window_end: now.toISOString(),
        email_count: fresh.length,
        brand_count: model.brandCount,
        resend_id: sendData?.id ?? null
      });
      await admin.from("notification_alerts").insert(
        fresh.map((s) => ({
          user_id: userId,
          company_id: s.companyId,
          kind: s.fingerprint,
          alerted_at: now.toISOString()
        }))
      );
      summary.sent += 1;
    } catch (err) {
      console.error(`seasonal run-up: send failed for ${userId}`, err);
      summary.errors += 1;
    }
  }

  return summary;
}
