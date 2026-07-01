import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { DigestCadence } from "@/lib/notification-prefs";
import { buildContext } from "./shared";
import { runDigest, type DigestRunSummary } from "@/lib/digest/run";
import { runUnusualActivity, type UnusualRunSummary } from "./run-unusual";

/**
 * Runs every enabled notification job for one cadence tick. Builds the
 * shared brand data once and hands it to each job, so adding notification
 * types costs one more job call, not another full DB sweep.
 */

export type NotificationsRunSummary = {
  cadence: DigestCadence;
  digest: DigestRunSummary;
  unusualActivity: UnusualRunSummary;
};

export async function runNotifications(
  cadence: DigestCadence
): Promise<NotificationsRunSummary> {
  const admin = getSupabaseAdmin();
  const ctx = await buildContext(admin, cadence);

  const digest = await runDigest(ctx);
  const unusualActivity = await runUnusualActivity(ctx);

  return { cadence, digest, unusualActivity };
}
