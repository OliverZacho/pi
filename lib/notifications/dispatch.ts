import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { DigestCadence } from "@/lib/notification-prefs";
import { buildContext } from "./shared";
import { runDigest, type DigestRunSummary } from "@/lib/digest/run";
import { runUnusualActivity, type UnusualRunSummary } from "./run-unusual";
import { runSeasonalRunup, type SeasonalRunSummary } from "./run-seasonal";
import {
  runSmartCollection,
  type SmartCollectionRunSummary
} from "./run-smart-collection";

/**
 * Runs every enabled notification job for one cadence tick. Builds the
 * shared brand data once and hands it to each job, so adding notification
 * types costs one more job call, not another full DB sweep.
 */

export type NotificationsRunSummary = {
  cadence: DigestCadence;
  digest: DigestRunSummary;
  unusualActivity: UnusualRunSummary;
  seasonalRunup: SeasonalRunSummary;
  smartCollection: SmartCollectionRunSummary;
};

export async function runNotifications(
  cadence: DigestCadence
): Promise<NotificationsRunSummary> {
  const admin = getSupabaseAdmin();
  const ctx = await buildContext(admin, cadence);

  const digest = await runDigest(ctx);
  const unusualActivity = await runUnusualActivity(ctx);
  const seasonalRunup = await runSeasonalRunup(ctx);
  const smartCollection = await runSmartCollection(ctx);

  return { cadence, digest, unusualActivity, seasonalRunup, smartCollection };
}
