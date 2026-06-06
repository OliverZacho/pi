import type { MirroredImage } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * Confidence threshold below which we will not persist an "email_heuristic"
 * pick. Scores roughly correspond to the rule weights in `scoreLogoFromHtml`
 * — a single weak signal (e.g. only "small dimensions") shouldn't be enough.
 */
export const LOGO_HEURISTIC_MIN_SCORE = 60;

/**
 * After this many emails for a given company we re-run the frequency-based
 * picker, which usually beats the heuristic from a single email.
 */
export const LOGO_FREQUENCY_MIN_EMAILS = 3;

/**
 * A non-`manual` logo at or below this confidence is treated as uncertain and
 * surfaced in the admin "Needs logo review" queue. Heuristic confidence is
 * `score / 150`; frequency confidence is `appearances / sampledEmails`.
 */
export const LOGO_REVIEW_MAX_CONFIDENCE = 0.5;

export type LogoCandidate = {
  remoteUrl: string;
  storagePath: string | null;
  score: number;
  confidence: number;
  reasons: string[];
};

type ImgTagInfo = {
  offset: number;
  fullTag: string;
  attrs: Record<string, string>;
  parentLinkHost: string | null;
  inFooterContext: boolean;
  isFirstInBody: boolean;
};

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const ANCHOR_OPEN_RE = /<a\b[^>]*>/gi;
const ANCHOR_CLOSE_RE = /<\/a\s*>/gi;
const FOOTER_OPEN_RE =
  /<footer\b|<\/main\s*>|class\s*=\s*["'][^"']*\b(footer|unsubscribe|preferences)\b[^"']*["']/i;
const BODY_OPEN_RE = /<body\b[^>]*>|<\/head\s*>/i;
const LOGO_FILENAME_RE = /(?:^|[\/_-])(?:logo|wordmark|brand(?:mark|ing)?|brandlogo)s?[\d_-]*\.(?:png|svg|jpg|jpeg|webp|gif)\b|\/logos?\//i;

/**
 * Parses the HTML once into a list of `<img>` tags with the surrounding
 * context we need for scoring (parent anchor's href host, whether the tag
 * sits below a footer/unsubscribe marker, byte offset for positional bonus).
 */
function indexImageTags(html: string): ImgTagInfo[] {
  if (!html) {
    return [];
  }

  type AnchorFrame = { host: string | null; end: number };
  const anchorStack: AnchorFrame[] = [];
  const anchorEvents: Array<
    | { kind: "open"; index: number; host: string | null }
    | { kind: "close"; index: number }
  > = [];

  for (const m of html.matchAll(ANCHOR_OPEN_RE)) {
    const hrefMatch = m[0].match(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const raw = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    let host: string | null = null;
    if (raw) {
      try {
        host = new URL(raw).hostname.toLowerCase();
      } catch {
        host = null;
      }
    }
    anchorEvents.push({ kind: "open", index: m.index ?? 0, host });
  }
  for (const m of html.matchAll(ANCHOR_CLOSE_RE)) {
    anchorEvents.push({ kind: "close", index: m.index ?? 0 });
  }
  anchorEvents.sort((a, b) => a.index - b.index);

  const imgTags: ImgTagInfo[] = [];
  const sortedAnchors = [...anchorEvents];
  let anchorCursor = 0;
  const footerStart = (() => {
    const match = html.match(FOOTER_OPEN_RE);
    return match?.index ?? -1;
  })();
  const bodyOpen = (() => {
    const match = html.match(BODY_OPEN_RE);
    return match?.index ?? -1;
  })();
  // The first `<img>` whose offset falls after `<body>` (or after `</head>`
  // when no body tag exists) gets a bonus. Many Klaviyo/Mailchimp emails
  // bury ~10KB of preheader/style boilerplate above the logo, which would
  // otherwise push it out of the "near top of email" bucket on byte offset.
  let firstInBodyMarked = false;

  for (const m of html.matchAll(IMG_TAG_RE)) {
    const index = m.index ?? 0;

    while (anchorCursor < sortedAnchors.length && sortedAnchors[anchorCursor].index < index) {
      const event = sortedAnchors[anchorCursor];
      if (event.kind === "open") {
        anchorStack.push({ host: event.host, end: -1 });
      } else if (event.kind === "close") {
        anchorStack.pop();
      }
      anchorCursor += 1;
    }

    const parentLinkHost = anchorStack.length > 0
      ? anchorStack[anchorStack.length - 1].host
      : null;

    const attrs = parseImgAttributes(m[0]);
    const isFirstInBody =
      !firstInBodyMarked && (bodyOpen < 0 || index > bodyOpen);

    if (isFirstInBody) {
      firstInBodyMarked = true;
    }

    imgTags.push({
      offset: index,
      fullTag: m[0],
      attrs,
      parentLinkHost,
      inFooterContext: footerStart >= 0 && index > footerStart,
      isFirstInBody
    });
  }

  return imgTags;
}

function parseImgAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRe = /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g;
  for (const match of tag.matchAll(attrRe)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    out[name] = value;
  }
  return out;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

function hostsMatch(host: string | null, companyDomain: string): boolean {
  if (!host) {
    return false;
  }
  const a = normalizeDomain(host);
  const b = normalizeDomain(companyDomain);
  return a === b || a.endsWith(`.${b}`);
}

function parseDimension(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const numeric = parseFloat(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function aspectRatio(width: number | null, height: number | null): number | null {
  if (!width || !height) {
    return null;
  }
  return width / height;
}

function pickContentType(asset: MirroredImage | null): string {
  return asset?.contentType ?? "application/octet-stream";
}

export type ScoreLogoFromHtmlInput = {
  html: string;
  companyDomain: string;
  /**
   * The pool of images we already mirrored for this email. Only candidates
   * present in this pool can be promoted to a logo, because we need a stable
   * storage path to render later.
   */
  mirroredAssets: MirroredImage[];
};

export type ScoredCandidate = LogoCandidate & {
  remoteUrl: string;
  storagePath: string;
};

/**
 * Scores every `<img>` tag in the email's HTML and returns the candidates
 * ordered by descending score. Only candidates whose `src` was actually
 * mirrored (and therefore lives in our `email-assets` bucket) are returned —
 * we never promote an un-mirrored hotlink to the canonical company logo.
 */
export function scoreLogoCandidatesFromHtml(
  input: ScoreLogoFromHtmlInput
): ScoredCandidate[] {
  const { html, companyDomain, mirroredAssets } = input;
  const tags = indexImageTags(html);
  if (tags.length === 0 || mirroredAssets.length === 0) {
    return [];
  }

  const htmlLength = Math.max(1, html.length);
  const remoteUrlToAsset = new Map<string, MirroredImage>();
  for (const asset of mirroredAssets) {
    remoteUrlToAsset.set(asset.remoteUrl, asset);
  }

  // First, score every individual `<img>` instance. We aggregate by storage
  // path afterwards so a logo that appears twice (e.g. desktop + responsive
  // variant) is collapsed into one candidate with a duplicate-in-email
  // bonus, rather than two competing rows that split its score.
  type Instance = {
    remoteUrl: string;
    asset: MirroredImage;
    score: number;
    reasons: string[];
    aboveFold: boolean;
  };

  const instances: Instance[] = [];

  for (const tag of tags) {
    const src = (tag.attrs.src ?? "").trim();
    if (!src) {
      continue;
    }

    const asset = remoteUrlToAsset.get(src);
    if (!asset) {
      // Image wasn't mirrored (failed fetch, too large, hotlinked from
      // somewhere we couldn't reach). Skip — we can't serve it later.
      continue;
    }

    const reasons: string[] = [];
    let score = 0;
    const positionalRatio = tag.offset / htmlLength;
    const aboveFold = positionalRatio <= 0.5;

    // Positional bonus: very top of email = almost certainly the header logo.
    if (positionalRatio <= 0.15) {
      score += 35;
      reasons.push("near top of email");
    } else if (positionalRatio <= 0.3) {
      score += 15;
      reasons.push("in upper third");
    }

    // Independent first-img-in-body bonus: stacks with positional. Many
    // emails bury 5-15KB of preheader/head/style boilerplate above the
    // logo, which would otherwise push it past the 15% byte-offset
    // threshold even though it's clearly the first visible image.
    if (tag.isFirstInBody && !tag.inFooterContext) {
      score += 25;
      reasons.push("first image in body");
    }

    if (tag.inFooterContext) {
      score -= 50;
      reasons.push("inside footer/unsubscribe region");
    }

    const alt = (tag.attrs.alt ?? "").toLowerCase();
    const fileName = src.toLowerCase();
    const ariaLabel = (tag.attrs["aria-label"] ?? "").toLowerCase();
    if (/\blogo\b/.test(alt) || /\blogo\b/.test(ariaLabel) || /\bwordmark\b/.test(alt)) {
      score += 50;
      reasons.push('alt="logo"');
    }
    if (LOGO_FILENAME_RE.test(fileName)) {
      score += 40;
      reasons.push("filename suggests logo/wordmark");
    }

    if (hostsMatch(tag.parentLinkHost, companyDomain)) {
      score += 40;
      reasons.push("wrapped in link to company domain");
    }

    const width = parseDimension(tag.attrs.width);
    const height = parseDimension(tag.attrs.height);
    if (width !== null && width >= 40 && width <= 320) {
      score += 18;
      reasons.push(`width=${Math.round(width)}px`);
    } else if (width !== null && width > 600) {
      score -= 20;
      reasons.push("very wide (likely hero)");
    }

    const ratio = aspectRatio(width, height);
    if (ratio !== null && ratio >= 0.25 && ratio <= 6) {
      score += 8;
      reasons.push(`aspect ${ratio.toFixed(2)}`);
    }

    const contentType = pickContentType(asset);
    if (contentType === "image/svg+xml") {
      score += 20;
      reasons.push("svg");
    } else if (contentType === "image/png") {
      score += 12;
      reasons.push("png");
    } else if (contentType === "image/gif") {
      score -= 25;
      reasons.push("gif (likely animation)");
    }

    // Bytes: logos are rarely >150KB. Heroes routinely are >500KB.
    // byteLength === 0 means "unknown" (e.g. the backfill script can't
    // re-download the asset just to weigh it) — skip the byte signals.
    if (asset.byteLength > 0 && asset.byteLength <= 60_000) {
      score += 10;
      reasons.push(`${Math.round(asset.byteLength / 1024)}KB`);
    } else if (asset.byteLength > 250_000) {
      score -= 15;
      reasons.push("large file");
    }

    // 1x1 spacer GIFs / tracking pixels — the byte-size heuristic only fires
    // when we actually have a measurement.
    const isTrackingPixel =
      (width === 1 && height === 1) ||
      (asset.byteLength > 0 && asset.byteLength < 200);
    if (isTrackingPixel) {
      score -= 80;
      reasons.push("tracking pixel");
    }

    instances.push({
      remoteUrl: src,
      asset,
      score,
      reasons,
      aboveFold
    });
  }

  // Aggregate by storage path. Identical images get scored once per `<img>`
  // tag — collapse them, keep the best variant's score/reasons, and add a
  // bonus when the same image appears multiple times above the fold (a
  // strong "this is the logo" signal — desktop + responsive duplicate).
  type AggregateState = {
    bestScore: number;
    bestReasons: string[];
    remoteUrl: string;
    storagePath: string;
    aboveFoldCount: number;
    totalCount: number;
  };

  const aggregated = new Map<string, AggregateState>();
  for (const instance of instances) {
    const key = instance.asset.storagePath;
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, {
        bestScore: instance.score,
        bestReasons: instance.reasons,
        remoteUrl: instance.remoteUrl,
        storagePath: instance.asset.storagePath,
        aboveFoldCount: instance.aboveFold ? 1 : 0,
        totalCount: 1
      });
      continue;
    }
    if (instance.score > existing.bestScore) {
      existing.bestScore = instance.score;
      existing.bestReasons = instance.reasons;
      existing.remoteUrl = instance.remoteUrl;
    }
    if (instance.aboveFold) {
      existing.aboveFoldCount += 1;
    }
    existing.totalCount += 1;
  }

  const scored: ScoredCandidate[] = [];
  for (const state of aggregated.values()) {
    let score = state.bestScore;
    const reasons = [...state.bestReasons];
    if (state.aboveFoldCount >= 2) {
      score += 20;
      reasons.push(`repeats ${state.aboveFoldCount}x above the fold`);
    }
    scored.push({
      remoteUrl: state.remoteUrl,
      storagePath: state.storagePath,
      score,
      confidence: clamp01(score / 150),
      reasons
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export type LogoFrequencyPick = {
  storagePath: string;
  emailCount: number;
  confidence: number;
};

/**
 * Aggregates `captured_emails.image_urls` (which are dedup'ed storage paths
 * keyed by SHA-1 of the bytes) across all emails for the given company. The
 * image that appears in the most emails is the most likely logo. We only
 * consider it a confident match if it shows up across multiple emails.
 */
export async function pickLogoByFrequency(
  companyId: string
): Promise<LogoFrequencyPick | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("captured_emails")
    .select("image_urls")
    .eq("company_id", companyId)
    .not("image_urls", "eq", "{}")
    .order("received_at", { ascending: false })
    .limit(50);

  if (error || !data) {
    return null;
  }

  if (data.length < LOGO_FREQUENCY_MIN_EMAILS) {
    return null;
  }

  const tallies = new Map<string, number>();
  for (const row of data) {
    const paths = Array.isArray(row.image_urls) ? row.image_urls : [];
    const unique = new Set<string>(paths);
    for (const path of unique) {
      tallies.set(path, (tallies.get(path) ?? 0) + 1);
    }
  }

  if (tallies.size === 0) {
    return null;
  }

  let best: { path: string; count: number } | null = null;
  for (const [path, count] of tallies.entries()) {
    if (!best || count > best.count) {
      best = { path, count };
    }
  }

  if (!best) {
    return null;
  }

  // Show up in at least half the sampled emails, and at least the minimum.
  const minRequired = Math.max(LOGO_FREQUENCY_MIN_EMAILS, Math.ceil(data.length / 2));
  if (best.count < minRequired) {
    return null;
  }

  return {
    storagePath: best.path,
    emailCount: best.count,
    confidence: clamp01(best.count / data.length)
  };
}
