import type { Tables } from "@/types/supabase";
import {
  LOGO_FREQUENCY_MIN_EMAILS,
  LOGO_HEURISTIC_MIN_SCORE,
  pickLogoByFrequency,
  scoreLogoCandidatesFromHtml,
  type ScoredCandidate
} from "./extract-logo";
import type { MirroredImage } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";

export type LogoSource = "email_heuristic" | "email_frequency" | "manual";

type CompanyLogoRow = Pick<
  Tables<"companies">,
  "id" | "domain" | "logo_storage_path" | "logo_source" | "logo_confidence"
>;

/**
 * Source-strength order. A new pick only replaces the stored logo when:
 *   - the new source is strictly stronger, OR
 *   - the new source matches the stored source AND has higher confidence.
 * `manual` always wins and is never auto-overwritten.
 */
const SOURCE_RANK: Record<LogoSource, number> = {
  email_heuristic: 1,
  email_frequency: 2,
  manual: 3
};

export type LogoUpdate = {
  source: "email_heuristic" | "email_frequency";
  storagePath: string;
  confidence: number;
};

function shouldReplace(current: CompanyLogoRow, update: LogoUpdate): boolean {
  const currentSource = (current.logo_source ?? null) as LogoSource | null;
  if (currentSource === "manual") {
    return false;
  }
  if (!currentSource || !current.logo_storage_path) {
    return true;
  }
  const currentRank = SOURCE_RANK[currentSource];
  const newRank = SOURCE_RANK[update.source];
  if (newRank > currentRank) {
    return true;
  }
  if (newRank < currentRank) {
    return false;
  }
  // Same source: prefer the higher-confidence pick.
  const currentConfidence = current.logo_confidence ?? 0;
  return update.confidence > currentConfidence + 0.05;
}

async function fetchCompanyLogoState(
  companyId: string
): Promise<CompanyLogoRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("companies")
    .select("id, domain, logo_storage_path, logo_source, logo_confidence")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return data;
}

async function writeCompanyLogo(
  companyId: string,
  update: LogoUpdate
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("companies")
    .update({
      logo_storage_path: update.storagePath,
      logo_source: update.source,
      logo_confidence: clamp01(update.confidence),
      logo_updated_at: new Date().toISOString()
    })
    .eq("id", companyId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`failed to update company logo: ${error.message}`);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export type ProcessEmailLogoArgs = {
  companyId: string;
  companyDomain: string;
  html: string;
  mirroredAssets: MirroredImage[];
  /**
   * How many emails the brand has captured *including* this one. Used to
   * decide when to upgrade to the frequency-based picker.
   */
  emailCountForCompany: number;
};

export type ProcessEmailLogoResult = {
  applied: LogoUpdate | null;
  bestCandidate: ScoredCandidate | null;
  reason: string;
};

/**
 * Looks at one freshly ingested email, tries the heuristic + frequency
 * pickers, and persists the winner if it beats whatever is currently stored.
 * Non-throwing — the only side effect on failure is a `null` `applied`.
 */
export async function processEmailForCompanyLogo(
  args: ProcessEmailLogoArgs
): Promise<ProcessEmailLogoResult> {
  const current = await fetchCompanyLogoState(args.companyId);
  if (!current) {
    return { applied: null, bestCandidate: null, reason: "company not found" };
  }

  if (current.logo_source === "manual") {
    return { applied: null, bestCandidate: null, reason: "manual override in place" };
  }

  const candidates = scoreLogoCandidatesFromHtml({
    html: args.html,
    companyDomain: args.companyDomain,
    mirroredAssets: args.mirroredAssets
  });

  const heuristicBest = candidates.find((c) => c.score >= LOGO_HEURISTIC_MIN_SCORE) ?? null;

  let chosen: LogoUpdate | null = null;

  if (heuristicBest) {
    const update: LogoUpdate = {
      source: "email_heuristic",
      storagePath: heuristicBest.storagePath,
      confidence: heuristicBest.confidence
    };
    if (shouldReplace(current, update)) {
      chosen = update;
    }
  }

  // Frequency pass is more authoritative once we have enough mail. Even if
  // the heuristic on *this* email is empty, the frequency picker can still
  // upgrade a previously-stored email_heuristic logo to email_frequency.
  if (args.emailCountForCompany >= LOGO_FREQUENCY_MIN_EMAILS) {
    const frequencyPick = await pickLogoByFrequency(args.companyId);
    if (frequencyPick) {
      const update: LogoUpdate = {
        source: "email_frequency",
        storagePath: frequencyPick.storagePath,
        confidence: frequencyPick.confidence
      };
      if (shouldReplace(current, update)) {
        chosen = update;
      }
    }
  }

  if (!chosen) {
    return {
      applied: null,
      bestCandidate: heuristicBest,
      reason:
        candidates.length === 0
          ? "no candidates from this email"
          : heuristicBest
            ? "stored logo already at or above this confidence"
            : `top score ${candidates[0].score} below threshold ${LOGO_HEURISTIC_MIN_SCORE}`
    };
  }

  await writeCompanyLogo(args.companyId, chosen);
  return { applied: chosen, bestCandidate: heuristicBest, reason: "updated" };
}
