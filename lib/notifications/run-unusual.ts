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
import { detectUnusualSignals, buildUnusualModel } from "./unusual-build";
import { renderUnusualEmail } from "./unusual-render";

/**
 * The "unusual sending activity" job for one cadence. Detects pace spikes
 * and gone-quiet spells across each user's followed brands, then alerts
 * only on signals not already sent within the cooldown, so an ongoing
 * spike or silence isn't re-mailed every tick.
 */

const NOTIFICATION_TYPE = "unusual_activity";
/** Don't re-alert the same brand+signal within this window. */
const ALERT_COOLDOWN_MS = 14 * 86_400_000;

export type UnusualRunSummary = {
  cadence: DigestCadence;
  eligible: number;
  sent: number;
  skippedEmpty: number;
  errors: number;
};

/** Set of `${user}|${company}|${kind}` alerted within the cooldown. */
async function recentAlerts(
  admin: SupabaseAdmin,
  userIds: string[],
  now: Date
): Promise<Set<string>> {
  const seen = new Set<string>();
  if (userIds.length === 0) return seen;
  const cutoff = new Date(now.getTime() - ALERT_COOLDOWN_MS).toISOString();
  const { data } = await admin
    .from("notification_alerts")
    .select("user_id, company_id, kind")
    .gte("alerted_at", cutoff)
    .in("user_id", userIds);
  for (const row of data ?? []) {
    seen.add(`${row.user_id}|${row.company_id}|${row.kind}`);
  }
  return seen;
}

export async function runUnusualActivity(
  ctx: NotificationContext
): Promise<UnusualRunSummary> {
  const { admin, cadence, brandData, followsByUser, emailByUser } = ctx;
  const now = new Date();
  const summary: UnusualRunSummary = {
    cadence,
    eligible: 0,
    sent: 0,
    skippedEmpty: 0,
    errors: 0
  };

  const userIds = await resolveAudience(admin, "unusualActivity", cadence);
  summary.eligible = userIds.length;
  if (userIds.length === 0) return summary;

  const alerted = await recentAlerts(admin, userIds, now);

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

    const fresh = detectUnusualSignals(brands).filter(
      (s) => !alerted.has(`${userId}|${s.companyId}|${s.kind}`)
    );
    if (fresh.length === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const model = buildUnusualModel(cadence, fresh);
    const { subject, html, text } = renderUnusualEmail(model);
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
          kind: s.kind,
          alerted_at: now.toISOString()
        }))
      );
      summary.sent += 1;
    } catch (err) {
      console.error(`unusual activity: send failed for ${userId}`, err);
      summary.errors += 1;
    }
  }

  return summary;
}
