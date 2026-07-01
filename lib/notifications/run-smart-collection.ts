import "server-only";
import { getResend } from "@/lib/resend";
import type { DigestCadence } from "@/lib/notification-prefs";
import {
  parseCollectionRules,
  evaluateCollectionRuleIds
} from "@/lib/collections-db";
import {
  resolveAudience,
  NOTIFICATION_FROM,
  CADENCE_MS,
  type NotificationContext,
  type SupabaseAdmin
} from "./shared";
import { APP_URL } from "./email-shell";
import {
  buildSmartCollectionModel,
  type CollectionMatch
} from "./smart-collection-build";
import { renderSmartCollectionEmail } from "./smart-collection-render";

/**
 * The "new matches in a smart collection" job for one cadence. For each
 * user's rule-based collections, counts emails matching the rules that
 * were ingested since the last send (created_at based, matching the
 * in-app "new emails" indicator) and alerts on the ones that grew.
 *
 * Dedup is windowed: the next run only looks at rows created after this
 * send, so a match is reported once.
 */

const NOTIFICATION_TYPE = "smart_collection";
/** Cap matches counted per collection per run. */
const MATCH_LIMIT = 100;
/** Example subjects shown per collection in the email. */
const SAMPLE_COUNT = 3;

export type SmartCollectionRunSummary = {
  cadence: DigestCadence;
  eligible: number;
  sent: number;
  skippedEmpty: number;
  errors: number;
};

async function windowStartFor(
  admin: SupabaseAdmin,
  userId: string,
  cadence: DigestCadence,
  now: Date
): Promise<Date> {
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
    const ms = Date.parse(data.sent_at);
    if (!Number.isNaN(ms)) return new Date(ms);
  }
  return new Date(now.getTime() - CADENCE_MS[cadence]);
}

async function sampleSubjects(
  admin: SupabaseAdmin,
  ids: string[]
): Promise<{ subject: string; brandName: string | null }[]> {
  if (ids.length === 0) return [];
  const { data } = await admin
    .from("captured_emails")
    .select("subject, companies(name)")
    .in("id", ids)
    .order("received_at", { ascending: false })
    .limit(SAMPLE_COUNT);
  return (data ?? []).map((row) => {
    const company = Array.isArray(row.companies)
      ? row.companies[0]
      : row.companies;
    return { subject: row.subject, brandName: company?.name ?? null };
  });
}

export async function runSmartCollection(
  ctx: NotificationContext
): Promise<SmartCollectionRunSummary> {
  const { admin, cadence, emailByUser } = ctx;
  const now = new Date();
  const summary: SmartCollectionRunSummary = {
    cadence,
    eligible: 0,
    sent: 0,
    skippedEmpty: 0,
    errors: 0
  };

  const userIds = await resolveAudience(admin, "smartCollection", cadence);
  summary.eligible = userIds.length;
  if (userIds.length === 0) return summary;

  for (const userId of userIds) {
    const to = emailByUser.get(userId);
    if (!to) {
      summary.skippedEmpty += 1;
      continue;
    }

    // The user's rule-based ("smart") collections.
    const { data: rows } = await admin
      .from("collections")
      .select("id, name, rules")
      .eq("user_id", userId);
    const smart = (rows ?? [])
      .map((row) => ({
        id: row.id,
        name: row.name,
        rules: parseCollectionRules(row.rules)
      }))
      .filter(
        (c): c is { id: string; name: string; rules: NonNullable<typeof c.rules> } =>
          c.rules !== null && c.rules.conditions.length > 0
      );
    if (smart.length === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const since = (await windowStartFor(admin, userId, cadence, now)).toISOString();

    const matches: CollectionMatch[] = [];
    for (const collection of smart) {
      try {
        const ids = await evaluateCollectionRuleIds(admin, collection.rules, {
          createdAfter: since,
          limit: MATCH_LIMIT
        });
        if (ids.length === 0) continue;
        matches.push({
          collectionId: collection.id,
          collectionName: collection.name,
          newCount: ids.length,
          samples: await sampleSubjects(admin, ids.slice(0, SAMPLE_COUNT))
        });
      } catch (err) {
        console.error(
          `smart collection: rule eval failed for ${collection.id}`,
          err
        );
      }
    }

    const model = buildSmartCollectionModel(cadence, matches);
    if (model.collections.length === 0) {
      summary.skippedEmpty += 1;
      continue;
    }

    const { subject, html, text } = renderSmartCollectionEmail(model);
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
        window_start: since,
        window_end: now.toISOString(),
        email_count: model.totalNew,
        brand_count: model.collectionCount,
        resend_id: sendData?.id ?? null
      });
      summary.sent += 1;
    } catch (err) {
      console.error(`smart collection: send failed for ${userId}`, err);
      summary.errors += 1;
    }
  }

  return summary;
}
