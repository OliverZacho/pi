import type { Tables } from "@/types/supabase";
import {
  LOGO_FREQUENCY_MIN_EMAILS,
  LOGO_HEURISTIC_MIN_SCORE,
  pickLogoByFrequency,
  scoreLogoCandidatesFromHtml,
  type ScoredCandidate
} from "./extract-logo";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { isStoredImageBlank } from "./image-analysis";
import {
  BRAND_LOGO_TRANSFORM,
  EMAIL_ASSETS_BUCKET,
  getSignedAssets,
  type MirroredImage
} from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";

export type LogoSource = "email_heuristic" | "email_frequency" | "manual";

type CompanyLogoRow = Pick<
  Tables<"companies">,
  | "id"
  | "domain"
  | "logo_storage_path"
  | "logo_origin_path"
  | "logo_source"
  | "logo_confidence"
  | "logo_stale"
>;

/**
 * A `manual` logo pick stays until the brand stops sending it. Once the picked
 * image is absent from this many of the company's most-recent emails in a row,
 * ingest flags it stale so it resurfaces in the admin review queue (the brand
 * likely rebranded).
 */
export const LOGO_MANUAL_STALE_AFTER_EMAILS = 10;

/**
 * Pure predicate: given a manual logo path and the image-path lists of a
 * company's most-recent emails (newest first), decides whether the pick has
 * gone stale. Stale = we have at least the threshold of emails to judge by and
 * the path appears in none of the most-recent `threshold` of them.
 */
export function isManualLogoStale(
  manualPath: string | null,
  recentEmailImagePaths: string[][],
  threshold: number = LOGO_MANUAL_STALE_AFTER_EMAILS
): boolean {
  if (!manualPath || recentEmailImagePaths.length < threshold) {
    return false;
  }
  const window = recentEmailImagePaths.slice(0, threshold);
  return window.every((paths) => !paths.includes(manualPath));
}

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
    .select("id, domain, logo_storage_path, logo_origin_path, logo_source, logo_confidence, logo_stale")
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
      logo_updated_at: new Date().toISOString(),
      // Automatic picks are governed by confidence, not staleness.
      logo_stale: false
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
    // Manual picks are never auto-replaced, but a brand can rebrand and stop
    // sending the picked image. Re-evaluate staleness so a long-gone logo
    // resurfaces in the review queue.
    await refreshManualLogoStaleness(
      args.companyId,
      current.logo_origin_path ?? current.logo_storage_path,
      args.mirroredAssets.map((asset) => asset.storagePath)
    );
    return { applied: null, bestCandidate: null, reason: "manual override in place" };
  }

  const candidates = scoreLogoCandidatesFromHtml({
    html: args.html,
    companyDomain: args.companyDomain,
    mirroredAssets: args.mirroredAssets
  });

  // First candidate that clears the threshold *and* isn't visually blank.
  // Candidates are sorted by descending score, so we can stop scanning once we
  // fall below the threshold. The blank check skips transparent spacers and
  // solid-colour blocks that sit at the top of an email and would otherwise
  // score like a header logo.
  let heuristicBest: ScoredCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.score < LOGO_HEURISTIC_MIN_SCORE) {
      break;
    }
    if (await isStoredImageBlank(candidate.storagePath)) {
      continue;
    }
    heuristicBest = candidate;
    break;
  }

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

// ---------------------------------------------------------------------------
// Admin-facing logo management: candidate pool, manual override, invert.
// ---------------------------------------------------------------------------

const IMAGE_EXTENSION_RE = /\.([a-z0-9]{2,5})$/i;

const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon"
};

function contentTypeForPath(storagePath: string): string {
  const ext = storagePath.match(IMAGE_EXTENSION_RE)?.[1]?.toLowerCase() ?? "";
  return EXTENSION_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

export type LogoCandidateImage = {
  storagePath: string;
  signedUrl: string | null;
  emailCount: number;
  contentType: string;
  isCurrent: boolean;
};

export type CompanyLogoState = {
  current: {
    storagePath: string | null;
    signedUrl: string | null;
    source: LogoSource | null;
    confidence: number | null;
    /** Manual pick that has dropped out of the brand's recent emails. */
    stale: boolean;
  };
  candidates: LogoCandidateImage[];
};

/**
 * Recomputes and persists the `logo_stale` flag for a company's manual logo.
 * The freshly-ingested email's mirrored paths are treated as "seen" so a brand
 * that is still using the picked image is never flagged, even before
 * read-after-write of its row settles.
 */
async function refreshManualLogoStaleness(
  companyId: string,
  manualPath: string | null,
  currentEmailPaths: string[]
): Promise<void> {
  const supabase = getSupabaseAdmin();

  let stale = false;
  if (manualPath && !currentEmailPaths.includes(manualPath)) {
    const { data } = await supabase
      .from("captured_emails")
      .select("image_urls")
      .eq("company_id", companyId)
      .order("received_at", { ascending: false })
      .limit(LOGO_MANUAL_STALE_AFTER_EMAILS);
    const window = (data ?? []).map((row) =>
      Array.isArray(row.image_urls) ? row.image_urls : []
    );
    stale = isManualLogoStale(manualPath, window);
  }

  await supabase
    .from("companies")
    .update({ logo_stale: stale })
    .eq("id", companyId)
    .is("deleted_at", null);
}

/**
 * Aggregates every distinct mirrored image across the company's captured
 * emails into a candidate pool, ranked by how many emails it appears in. Used
 * by the admin logo manager so an operator can hand-pick the right logo.
 * Mirrors the tally in `pickLogoByFrequency`, but keeps every image (and always
 * includes the current pick) rather than collapsing to a single winner.
 */
export async function getLogoCandidatesForCompany(
  companyId: string
): Promise<CompanyLogoState> {
  const supabase = getSupabaseAdmin();

  const current = await fetchCompanyLogoState(companyId);
  const currentPath = current?.logo_storage_path ?? null;

  const { data, error } = await supabase
    .from("captured_emails")
    .select("image_urls")
    .eq("company_id", companyId)
    .not("image_urls", "eq", "{}")
    .order("received_at", { ascending: false })
    .limit(200);

  const tallies = new Map<string, number>();
  if (!error && data) {
    for (const row of data) {
      const paths = Array.isArray(row.image_urls) ? row.image_urls : [];
      const unique = new Set<string>(paths);
      for (const path of unique) {
        tallies.set(path, (tallies.get(path) ?? 0) + 1);
      }
    }
  }

  // Make sure the current logo is always present as a candidate even if it no
  // longer appears in the recent email window (e.g. a manual pick or an older
  // asset).
  if (currentPath && !tallies.has(currentPath)) {
    tallies.set(currentPath, 0);
  }

  const orderedPaths = Array.from(tallies.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);

  const signed =
    orderedPaths.length > 0
      ? await getSignedAssets(orderedPaths, { transform: BRAND_LOGO_TRANSFORM })
      : {};

  const candidates: LogoCandidateImage[] = orderedPaths.map((storagePath) => ({
    storagePath,
    signedUrl: signed[storagePath] ?? null,
    emailCount: tallies.get(storagePath) ?? 0,
    contentType: contentTypeForPath(storagePath),
    isCurrent: storagePath === currentPath
  }));

  return {
    current: {
      storagePath: currentPath,
      signedUrl: currentPath ? signed[currentPath] ?? null : null,
      source: (current?.logo_source ?? null) as LogoSource | null,
      confidence: current?.logo_confidence ?? null,
      stale: current?.logo_stale ?? false
    },
    candidates
  };
}

/**
 * Pins a company's logo to a specific image as a `manual` override. The path
 * must appear in the company's candidate pool.
 */
export async function setManualLogo(
  companyId: string,
  storagePath: string
): Promise<void> {
  const { candidates } = await getLogoCandidatesForCompany(companyId);
  const match = candidates.find((c) => c.storagePath === storagePath);
  if (!match) {
    throw new Error("Image is not a candidate for this company");
  }

  await writeManualLogo(companyId, storagePath, null);
}

/**
 * Writes a manual logo pick. `originPath` records the source image the pick
 * derives from for staleness purposes — `null` for a direct pick (origin ==
 * the pick itself), or the original mirrored path when the pick is a
 * derived/inverted asset that never appears in emails on its own.
 */
async function writeManualLogo(
  companyId: string,
  storagePath: string,
  originPath: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("companies")
    .update({
      logo_storage_path: storagePath,
      logo_origin_path: originPath,
      logo_source: "manual",
      logo_confidence: 1,
      logo_updated_at: new Date().toISOString(),
      // Fresh manual pick — clear any prior staleness flag.
      logo_stale: false
    })
    .eq("id", companyId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`failed to set manual logo: ${error.message}`);
  }
}

/**
 * Re-runs the automatic frequency picker and persists the result, or clears
 * the logo when nothing qualifies. Backs "revert to automatic".
 */
async function repickAutomaticLogo(companyId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const pick = await pickLogoByFrequency(companyId);
  const { error } = await supabase
    .from("companies")
    .update({
      logo_storage_path: pick?.storagePath ?? null,
      logo_origin_path: null,
      logo_source: pick ? "email_frequency" : null,
      logo_confidence: pick ? clamp01(pick.confidence) : null,
      logo_updated_at: new Date().toISOString(),
      logo_stale: false
    })
    .eq("id", companyId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`failed to re-pick logo: ${error.message}`);
  }
}

/** Drops a `manual` override and falls back to the automatic picker. */
export async function clearManualLogo(companyId: string): Promise<void> {
  await repickAutomaticLogo(companyId);
}

/**
 * Inverts a candidate image's colours (white → black, preserving
 * transparency) and pins the result as the manual logo. Useful for white/
 * light-on-transparent wordmarks that are invisible on a light background.
 * The inverted asset is content-addressed and uploaded alongside the
 * originals; `logo_origin_path` keeps pointing at the source image so
 * staleness still tracks whether the brand is still sending that logo.
 */
export async function invertLogoImage(
  companyId: string,
  storagePath: string
): Promise<void> {
  const { candidates } = await getLogoCandidatesForCompany(companyId);
  const match = candidates.find((c) => c.storagePath === storagePath);
  if (!match) {
    throw new Error("Image is not a candidate for this company");
  }

  const supabase = getSupabaseAdmin();

  const { data: blob, error: downloadError } = await supabase.storage
    .from(EMAIL_ASSETS_BUCKET)
    .download(storagePath);
  if (downloadError || !blob) {
    throw new Error(
      `failed to download image to invert: ${downloadError?.message ?? "not found"}`
    );
  }

  const inputBytes = Buffer.from(await blob.arrayBuffer());
  // negate({ alpha: false }) flips the RGB channels but leaves alpha intact,
  // so a white-on-transparent mark becomes black-on-transparent. Output PNG to
  // preserve the alpha channel regardless of the source format (incl. SVG,
  // which sharp rasterises).
  const invertedBytes = await sharp(inputBytes)
    .negate({ alpha: false })
    .png()
    .toBuffer();

  const digest = createHash("sha1").update(invertedBytes).digest("hex");
  const invertedPath = `${digest}.png`;

  const { error: uploadError } = await supabase.storage
    .from(EMAIL_ASSETS_BUCKET)
    .upload(invertedPath, invertedBytes, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "public, max-age=31536000, immutable"
    });
  if (uploadError) {
    throw new Error(`failed to upload inverted image: ${uploadError.message}`);
  }

  // Origin is the source image that still appears in emails, so staleness keeps
  // working. If the admin is inverting the *current* logo and that pick is
  // itself a derived asset, keep its original origin rather than pointing at a
  // path that never shows up in mail.
  const currentState = await fetchCompanyLogoState(companyId);
  const origin =
    storagePath === currentState?.logo_storage_path && currentState?.logo_origin_path
      ? currentState.logo_origin_path
      : storagePath;
  await writeManualLogo(companyId, invertedPath, origin);
}
