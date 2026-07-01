import "server-only";
import { getResend } from "@/lib/resend";
import type { BrandPageData } from "@/lib/brand-db";
import type { DigestCadence } from "@/lib/notification-prefs";
import {
  resolveAudience,
  NOTIFICATION_FROM,
  CADENCE_MS,
  type NotificationContext,
  type SupabaseAdmin
} from "@/lib/notifications/shared";
import { APP_URL } from "@/lib/notifications/email-shell";
import { buildDigestModel } from "./build";
import { renderDigestEmail } from "./render";

/**
 * The editorial digest job for one cadence. Runs over the shared
 * notification context (audience filtered to users whose "new email"
 * preference is this cadence), windowing each user's emails since their
 * last successful digest and suppressing a truly empty window.
 */

const NOTIFICATION_TYPE = "new_email";

/**
 * Minimum gap before the same user is sent another digest of this
 * cadence, guarding against a double cron fire. A touch under the cadence
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
    .eq("notification_type", NOTIFICATION_TYPE)
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
  return {
    start: new Date(now.getTime() - CADENCE_MS[cadence]),
    lastSentMs: null
  };
}

export async function runDigest(
  ctx: NotificationContext
): Promise<DigestRunSummary> {
  const { admin, cadence, brandData, followsByUser, emailByUser } = ctx;
  const now = new Date();
  const summary: DigestRunSummary = {
    cadence,
    eligible: 0,
    sent: 0,
    skippedEmpty: 0,
    skippedRecent: 0,
    errors: 0
  };

  const userIds = await resolveAudience(admin, "newEmail", cadence);
  summary.eligible = userIds.length;

  for (const userId of userIds) {
    const to = emailByUser.get(userId);
    const brandIds = followsByUser.get(userId) ?? [];
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
    if (
      lastSentMs !== null &&
      now.getTime() - lastSentMs < MIN_RESEND_MS[cadence]
    ) {
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
