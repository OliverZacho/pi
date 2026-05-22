import type { MirroredImage } from "./storage";

export type ParsedLink = {
  url: string;
  host: string | null;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
  };
};

export type SubjectMetadata = {
  length: number;
  word_count: number;
  emoji_count: number;
  uppercase_ratio: number;
  has_personalization_token: boolean;
};

export type AuthResults = {
  spf: "pass" | "fail" | "neutral" | "softfail" | "temperror" | "permerror" | "none" | null;
  dkim: "pass" | "fail" | "neutral" | "softfail" | "temperror" | "permerror" | "none" | null;
  dmarc: "pass" | "fail" | "neutral" | "softfail" | "temperror" | "permerror" | "none" | null;
};

/**
 * Captures the bulk-sender / mailing-list disclosure headers that mailbox
 * providers care about — most importantly the inputs Apple Mail uses to render
 * its built-in "Unsubscribe" button + the "This message is from a mailing
 * list" badge, and the inputs Gmail / Yahoo's 2024 bulk-sender rules require
 * (RFC 8058 one-click).
 *
 * `null` means we never had headers to inspect (e.g. backfill rows where the
 * raw payload didn't include them). A populated object with everything `false`
 * / `null` means we *did* have headers and these signals were genuinely absent
 * — that's the case worth flagging in the UI.
 */
export type ListHeaders = {
  /**
   * True iff a non-empty `List-Unsubscribe` header is present. This is what
   * makes Apple Mail show its built-in Unsubscribe button + mailing-list
   * disclosure, and is the minimum bar for Gmail's bulk-sender requirements.
   */
  has_list_unsubscribe: boolean;
  /** Mailto URI from `List-Unsubscribe` (angle brackets stripped), if any. */
  unsubscribe_mailto: string | null;
  /** http(s) URI from `List-Unsubscribe` (angle brackets stripped), if any. */
  unsubscribe_url: string | null;
  /**
   * True iff the message also has `List-Unsubscribe-Post: List-Unsubscribe=
   * One-Click` (RFC 8058). This is the one Gmail / Yahoo's 2024 sender rules
   * actually require for bulk senders — having it materially helps inbox
   * reputation.
   */
  has_one_click_post: boolean;
  /**
   * Inner identifier of the `List-Id` header (RFC 2919) with the optional
   * label and angle brackets stripped. Together with `has_list_unsubscribe`
   * this is the strongest "this is a mailing list" signal.
   */
  list_id: string | null;
};

export type PaletteSource = "inline" | "style_block" | "attribute";

export type PaletteColor = {
  hex: string;
  count: number;
  sources: PaletteSource[];
};

export type FontSource = "inline" | "style_block" | "attribute";

export type FontFamily = {
  family: string;
  /** Total occurrences across every `font-family` declaration (any position). */
  count: number;
  /**
   * How often this font was the *first non-generic* entry in a `font-family`
   * stack — i.e. the typeface the author actually intended to render.
   * Fallbacks (e.g. Arial / Helvetica trailing every stack) have a high
   * `count` but a `primary_count` of 0.
   */
  primary_count: number;
  sources: FontSource[];
};

export type EmailMetadata = {
  preheader: string | null;
  has_gif: boolean;
  has_dark_mode: boolean;
  has_amp_html: boolean;
  word_count: number;
  image_count: number;
  image_to_text_ratio: number;
  links: ParsedLink[];
  link_domains: string[];
  resource_hosts: string[];
  utm_index: ParsedLink["utm"][];
  subject_metadata: SubjectMetadata;
  auth_results: AuthResults | null;
  list_headers: ListHeaders | null;
  palette_colors: PaletteColor[];
  font_families: FontFamily[];
};

export type ExtractMetadataInput = {
  subject: string;
  html: string;
  plainText?: string | null;
  mirroredAssets?: MirroredImage[];
  headers?: Record<string, string> | null;
};

const PREHEADER_HIDDEN_STYLE_RE =
  /style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|max-height\s*:\s*0|max-width\s*:\s*0|font-size\s*:\s*0|line-height\s*:\s*0|mso-hide\s*:\s*all)[^"']*["']/i;

const PERSONALIZATION_TOKEN_RE =
  /(\{\{?\s*(?:first[_\s]?name|last[_\s]?name|customer[_\s]?name|name)\s*\}\}?|\*\|[A-Z_]+\|\*|%%[A-Z_]+%%|\$\{[A-Za-z_][A-Za-z0-9_]*\})/i;

const DARK_MODE_PATTERNS: RegExp[] = [
  /prefers-color-scheme/i,
  /\[data-ogsc\]/i,
  /\[data-ogsb\]/i,
  /color-scheme\s*:\s*(?:light\s+dark|dark\s+light|dark)/i,
  /<meta[^>]*name\s*=\s*["']color-scheme["'][^>]*>/i,
  /<meta[^>]*name\s*=\s*["']supported-color-schemes["'][^>]*>/i
];

export function extractMetadata(input: ExtractMetadataInput): EmailMetadata {
  const html = input.html ?? "";
  const plain = input.plainText ?? stripHtml(html);
  const subjectMeta = extractSubjectMetadata(input.subject ?? "");
  const links = extractLinks(html);
  const linkDomains = uniqueLowercase(links.map((link) => link.host).filter(isNonNull));
  const resourceHosts = extractResourceHosts(html);
  const utm_index = links
    .map((link) => link.utm)
    .filter((utm) => Object.values(utm).some((value) => value !== null));

  const wordCount = countWords(plain);
  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const ratio = imageCount === 0 ? 0 : imageCount / Math.max(1, wordCount);

  return {
    preheader: extractPreheader(html),
    has_gif: detectHasGif(html, input.mirroredAssets),
    has_dark_mode: detectDarkMode(html),
    has_amp_html: /<html[^>]+(?:amp|⚡)/i.test(html),
    word_count: wordCount,
    image_count: imageCount,
    image_to_text_ratio: Number(ratio.toFixed(4)),
    links,
    link_domains: linkDomains,
    resource_hosts: resourceHosts,
    utm_index,
    subject_metadata: subjectMeta,
    auth_results: extractAuthResults(input.headers ?? null),
    list_headers: extractListHeaders(input.headers ?? null),
    palette_colors: extractColorPalette(html),
    font_families: extractFontFamilies(html)
  };
}

const URL_LIKE_RE =
  /https?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:[\/:?#][^\s"'<>)]*)?/g;

export function extractResourceHosts(html: string): string[] {
  if (!html) {
    return [];
  }
  const seen = new Set<string>();
  for (const match of html.matchAll(URL_LIKE_RE)) {
    const host = match[1]?.toLowerCase();
    if (!host) {
      continue;
    }
    seen.add(host);
  }
  return Array.from(seen);
}

const PALETTE_DEFAULT_LIMIT = 24;
const HEX_TOKEN_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const RGB_TOKEN_RE = /rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/gi;
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR_RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const COLOR_ATTR_RE =
  /\b(?:bgcolor|color)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/gi;
const SCRIPT_BLOCK_RE = /<script\b[\s\S]*?<\/script>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const INVISIBLE_STYLE_RE =
  /(?:mso-hide\s*:\s*all|display\s*:\s*none|visibility\s*:\s*hidden)/i;
// Interaction pseudo-classes only apply to user states, not the default
// rendered email — so their declarations don't represent the brand's
// visual identity. Eva Solo's bright `#003dcc` "blue" came entirely from
// `.es-button-border:hover { border-color: #003dcc … }` boilerplate
// embedded by their ESP, which the brand never customised.
const INTERACTION_PSEUDO_RE =
  /:(?:hover|focus|focus-visible|focus-within|active|visited|link|target)\b/i;

/**
 * Captures the hex/rgb color tokens that appear in the email's HTML/CSS layout
 * (style blocks, inline `style` attributes, and legacy `bgcolor`/`color` attrs).
 * Image pixel data is intentionally not inspected — we only look at colour
 * tokens declared in the markup itself. RGB/RGBA values are normalised to
 * lowercase 6-char hex; alpha channels are stripped.
 */
export function extractColorPalette(
  html: string,
  limit: number = PALETTE_DEFAULT_LIMIT
): PaletteColor[] {
  if (!html) {
    return [];
  }

  const cleaned = html.replace(SCRIPT_BLOCK_RE, " ").replace(HTML_COMMENT_RE, " ");

  const aggregate = new Map<string, { count: number; sources: Set<PaletteSource> }>();

  const record = (hex: string, source: PaletteSource): void => {
    const normalised = normaliseHex(hex);
    if (!normalised) {
      return;
    }
    const existing = aggregate.get(normalised);
    if (existing) {
      existing.count += 1;
      existing.sources.add(source);
    } else {
      aggregate.set(normalised, { count: 1, sources: new Set([source]) });
    }
  };

  const scanColors = (text: string, source: PaletteSource): void => {
    if (!text) {
      return;
    }
    for (const match of text.matchAll(HEX_TOKEN_RE)) {
      record(`#${match[1]}`, source);
    }
    for (const match of text.matchAll(RGB_TOKEN_RE)) {
      record(
        channelsToHex(
          clampChannel(Number(match[1])),
          clampChannel(Number(match[2])),
          clampChannel(Number(match[3]))
        ),
        source
      );
    }
  };

  for (const block of cleaned.matchAll(STYLE_BLOCK_RE)) {
    // Restrict the scan to CSS rule bodies (`{ … }`). Hex tokens that appear
    // in the selector part of a stylesheet are ID selectors, not colors —
    // e.g. Mailchimp templates routinely emit `#d13 p, #d13 h1 { … }` for
    // every section id, which the older naive scan was happily reporting as
    // brand colors. Declaration values are the only valid place for a hex
    // color, so we extract just those before running the token regex.
    scanColors(extractCssRuleBodies(block[1] ?? ""), "style_block");
  }

  for (const attr of cleaned.matchAll(STYLE_ATTR_RE)) {
    const styleText = attr[1] ?? attr[2] ?? "";
    // Skip styles that explicitly opt the element out of the rendered view.
    // `mso-hide:all` is the standard Outlook-only fallback marker used by
    // ESPs (Sendinblue, ActiveCampaign, …) to declare invisible duplicate
    // buttons whose `border-color` / `background` would otherwise pollute
    // the brand palette with default-template blues and greens that no
    // recipient ever actually sees. `display:none` / `visibility:hidden`
    // cover the same intent for non-Outlook clients.
    if (INVISIBLE_STYLE_RE.test(styleText)) {
      continue;
    }
    scanColors(styleText, "inline");
  }

  for (const attr of cleaned.matchAll(COLOR_ATTR_RE)) {
    const value = (attr[1] ?? attr[2] ?? attr[3] ?? "").trim();
    if (!value) {
      continue;
    }
    if (value.startsWith("#")) {
      const hexMatch = value.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
      if (hexMatch) {
        record(`#${hexMatch[1]}`, "attribute");
      }
      continue;
    }
    const rgbMatch = value.match(
      /^rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/i
    );
    if (rgbMatch) {
      record(
        channelsToHex(
          clampChannel(Number(rgbMatch[1])),
          clampChannel(Number(rgbMatch[2])),
          clampChannel(Number(rgbMatch[3]))
        ),
        "attribute"
      );
    }
  }

  const entries: PaletteColor[] = Array.from(aggregate.entries())
    .map(([hex, info]) => ({
      hex,
      count: info.count,
      sources: Array.from(info.sources).sort()
    }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));

  const cap = Math.max(0, Math.floor(limit));
  return cap > 0 ? entries.slice(0, cap) : entries;
}

const FONT_DEFAULT_LIMIT = 16;
const FONT_FAMILY_DECL_RE = /font-family\s*:\s*([^;}<]+)/gi;
const FONT_FACE_ATTR_RE =
  /<font\b[^>]*\bface\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/gi;

// CSS generic family keywords, global CSS values, and system-stack tokens that
// don't correspond to a specific typeface. We exclude these so the palette
// surfaces the actual brand fonts being chosen.
const FONT_GENERIC_KEYWORDS = new Set<string>([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "-apple-system",
  "blinkmacsystemfont"
]);

/**
 * Captures the typefaces an email actually references — every entry in a
 * `font-family` stack (style blocks + inline style attrs) plus legacy
 * `<font face="…">` attributes. CSS generic families (`sans-serif`,
 * `system-ui`, …) and system-stack tokens are filtered so the result reflects
 * the brand fonts being chosen rather than the always-present fallback chain.
 */
export function extractFontFamilies(
  html: string,
  limit: number = FONT_DEFAULT_LIMIT
): FontFamily[] {
  if (!html) {
    return [];
  }

  const cleaned = html.replace(SCRIPT_BLOCK_RE, " ").replace(HTML_COMMENT_RE, " ");

  const aggregate = new Map<
    string,
    {
      display: string;
      count: number;
      primary_count: number;
      sources: Set<FontSource>;
    }
  >();

  // Records one entry from a font-family stack. `isPrimary` marks the *first
  // non-generic* (= first accepted) entry of the surrounding declaration as
  // the author's intended typeface; the remaining entries are fallbacks.
  // Returns whether the entry was accepted (so callers can advance the
  // "primary slot" past filtered-out entries like `-apple-system`).
  const record = (rawValue: string, source: FontSource, isPrimary: boolean): boolean => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return false;
    }
    if (/^var\s*\(/i.test(trimmed)) {
      return false;
    }
    const key = trimmed.replace(/\s+/g, " ").toLowerCase();
    if (!key || FONT_GENERIC_KEYWORDS.has(key)) {
      return false;
    }
    const existing = aggregate.get(key);
    if (existing) {
      existing.count += 1;
      if (isPrimary) {
        existing.primary_count += 1;
      }
      existing.sources.add(source);
    } else {
      aggregate.set(key, {
        display: trimmed.replace(/\s+/g, " "),
        count: 1,
        primary_count: isPrimary ? 1 : 0,
        sources: new Set([source])
      });
    }
    return true;
  };

  const recordList = (parts: string[], source: FontSource): void => {
    let primaryAssigned = false;
    for (const part of parts) {
      const accepted = record(part, source, !primaryAssigned);
      if (accepted && !primaryAssigned) {
        primaryAssigned = true;
      }
    }
  };

  const scanDeclarations = (text: string, source: FontSource): void => {
    if (!text) {
      return;
    }
    // Inline `style="..."` attribute values typically encode the quotes
    // around font names as `&quot;` / `&apos;`. We decode *after* the
    // attribute has been captured so the trailing `;` of those entities no
    // longer terminates our `font-family: …` value regex prematurely.
    const decoded = decodeBasicHtmlEntities(text);
    for (const match of decoded.matchAll(FONT_FAMILY_DECL_RE)) {
      const value = match[1];
      if (!value) {
        continue;
      }
      recordList(splitFontFamilyList(value), source);
    }
  };

  for (const block of cleaned.matchAll(STYLE_BLOCK_RE)) {
    scanDeclarations(block[1] ?? "", "style_block");
  }

  for (const attr of cleaned.matchAll(STYLE_ATTR_RE)) {
    scanDeclarations(attr[1] ?? attr[2] ?? "", "inline");
  }

  for (const attr of cleaned.matchAll(FONT_FACE_ATTR_RE)) {
    const raw = decodeBasicHtmlEntities((attr[1] ?? attr[2] ?? attr[3] ?? "").trim());
    if (!raw) {
      continue;
    }
    recordList(splitFontFamilyList(raw), "attribute");
  }

  const entries: FontFamily[] = Array.from(aggregate.values())
    .map((info) => ({
      family: info.display,
      count: info.count,
      primary_count: info.primary_count,
      sources: Array.from(info.sources).sort()
    }))
    .sort(
      (a, b) =>
        b.primary_count - a.primary_count ||
        b.count - a.count ||
        a.family.localeCompare(b.family)
    );

  const cap = Math.max(0, Math.floor(limit));
  return cap > 0 ? entries.slice(0, cap) : entries;
}

/**
 * Returns just the *declaration values* inside a CSS source string — i.e.
 * the text that appears after `property:` and before the next `;` / `}`,
 * with rules whose selector contains an interaction pseudo-class
 * (`:hover`, `:focus`, `:active`, …) dropped entirely.
 *
 * This is intentionally stricter than "anything inside `{ … }`":
 *
 *   1. Selector text is never scanned. Hex tokens that appear in the
 *      selector part of a stylesheet are ID selectors, not colors —
 *      Mailchimp templates routinely emit `#d13 p, #d13 h1 { … }` and
 *      wrap their mobile overrides in `@media (...) { #b24, #b67 { … } }`,
 *      both of which would otherwise pollute the palette with whatever
 *      the section ids happen to look like in hex.
 *   2. Rules behind `:hover` / `:focus` / `:active` etc. are skipped.
 *      These are interaction states the recipient never sees by default,
 *      and ESP boilerplate (Sendinblue's `.es-button-border:hover`) often
 *      leaves a default platform color there that has nothing to do with
 *      the brand.
 *
 * Pseudo-class `:`s inside selectors (`.btn:hover`) are distinguished
 * from declaration `:`s (`color:#fff`) via a small look-ahead: a `:` is a
 * property/value separator iff the next `;` or `}` comes *before* the
 * next `{`.
 */
function extractCssRuleBodies(css: string): string {
  if (!css) {
    return "";
  }
  let depth = 0;
  let inValue = false;
  let pending = ""; // accumulates selector or property-name chars
  let out = "";
  const skipUntilDepth: number[] = [];

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      const isInteraction = INTERACTION_PSEUDO_RE.test(pending);
      depth += 1;
      if (isInteraction) {
        skipUntilDepth.push(depth);
      }
      pending = "";
      inValue = false;
      continue;
    }
    if (ch === "}") {
      if (
        skipUntilDepth.length > 0 &&
        skipUntilDepth[skipUntilDepth.length - 1] === depth
      ) {
        skipUntilDepth.pop();
      }
      if (depth > 0) depth -= 1;
      pending = "";
      inValue = false;
      continue;
    }
    if (skipUntilDepth.length > 0) {
      continue;
    }
    if (depth === 0) {
      pending += ch;
      continue;
    }
    if (ch === ";") {
      pending = "";
      inValue = false;
      out += " ";
      continue;
    }
    if (ch === ":" && !inValue) {
      if (isPseudoSelectorColon(css, i)) {
        pending += ch;
      } else {
        // Property name preceded the `:` — discard it, the value follows.
        pending = "";
        inValue = true;
        out += " ";
      }
      continue;
    }
    if (inValue) {
      out += ch;
    } else {
      pending += ch;
    }
  }
  return out;
}

/**
 * A `:` is part of a pseudo-class (e.g. `.btn:hover`) iff there's a `{`
 * before the next `;` / `}` — that means the surrounding token is a
 * selector that's about to open a rule body, not a property/value pair.
 * Tiny look-ahead bounded by the next statement terminator, so the cost
 * is amortised O(1) per declaration.
 */
function isPseudoSelectorColon(css: string, from: number): boolean {
  for (let j = from + 1; j < css.length; j += 1) {
    const c = css[j];
    if (c === "{") return true;
    if (c === ";" || c === "}") return false;
  }
  return false;
}

function splitFontFamilyList(value: string): string[] {
  return value
    .replace(/!important/gi, "")
    .split(",")
    .map((s) => s.trim())
    .map((s) => s.replace(/^["']/, "").replace(/["']$/, "").trim())
    .filter(Boolean);
}

/**
 * Decodes the handful of HTML entities that show up inside inline CSS values
 * (typically the quotes wrapping font-family names). Order matters: named and
 * numeric entities are resolved before `&amp;` so `&amp;quot;` is left alone.
 */
function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#34;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function normaliseHex(hex: string): string | null {
  const match = hex.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) {
    return null;
  }
  let value = match[1].toLowerCase();
  if (value.length === 3) {
    value = value
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  return `#${value}`;
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function channelsToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function extractPreheader(html: string): string | null {
  if (!html) {
    return null;
  }

  const elementRe = /<(div|span|p|td|table|tr)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = elementRe.exec(html)) !== null) {
    const attrs = match[2] ?? "";
    if (!PREHEADER_HIDDEN_STYLE_RE.test(attrs)) {
      continue;
    }
    const text = stripHtml(match[3] ?? "").trim();
    if (text.length >= 4 && text.length <= 250) {
      return text;
    }
  }

  const plain = stripHtml(html).trim();
  if (plain.length === 0) {
    return null;
  }
  return plain.slice(0, 140);
}

export function detectDarkMode(html: string): boolean {
  if (!html) {
    return false;
  }
  return DARK_MODE_PATTERNS.some((pattern) => pattern.test(html));
}

export function detectHasGif(html: string, mirroredAssets?: MirroredImage[]): boolean {
  if (mirroredAssets && mirroredAssets.some((asset) => asset.contentType === "image/gif")) {
    return true;
  }
  if (!html) {
    return false;
  }
  return /<img[^>]+src=["'][^"']+\.gif(?:["'?#])/i.test(html);
}

export function extractLinks(html: string): ParsedLink[] {
  if (!html) {
    return [];
  }
  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)];
  const seen = new Set<string>();
  const parsed: ParsedLink[] = [];

  for (const match of matches) {
    const raw = (match[1] ?? "").trim();
    if (!raw) {
      continue;
    }
    if (raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("#")) {
      continue;
    }
    if (seen.has(raw)) {
      continue;
    }
    seen.add(raw);

    let host: string | null = null;
    const utm: ParsedLink["utm"] = {
      source: null,
      medium: null,
      campaign: null,
      content: null,
      term: null
    };

    try {
      const u = new URL(raw);
      host = u.hostname.toLowerCase();
      utm.source = u.searchParams.get("utm_source");
      utm.medium = u.searchParams.get("utm_medium");
      utm.campaign = u.searchParams.get("utm_campaign");
      utm.content = u.searchParams.get("utm_content");
      utm.term = u.searchParams.get("utm_term");
    } catch {
      /* invalid URL — keep host null */
    }

    parsed.push({ url: raw, host, utm });
  }

  return parsed;
}

export function extractSubjectMetadata(subject: string): SubjectMetadata {
  const trimmed = subject.trim();
  const length = trimmed.length;
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const emojiCount = countEmoji(trimmed);
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  const uppercaseLetters = letters.replace(/[^A-Z]/g, "").length;
  const uppercaseRatio = letters.length === 0 ? 0 : uppercaseLetters / letters.length;
  return {
    length,
    word_count: wordCount,
    emoji_count: emojiCount,
    uppercase_ratio: Number(uppercaseRatio.toFixed(3)),
    has_personalization_token: PERSONALIZATION_TOKEN_RE.test(subject)
  };
}

export function extractAuthResults(
  headers: Record<string, string> | null
): AuthResults | null {
  if (!headers) {
    return null;
  }

  const lookup: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === "string" && typeof value === "string") {
      lookup[key.toLowerCase()] = value;
    }
  }

  const candidates = [
    lookup["authentication-results"],
    lookup["arc-authentication-results"],
    lookup["x-authentication-results"]
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  if (candidates.length === 0) {
    return null;
  }

  const blob = candidates.join(" ; ").toLowerCase();
  return {
    spf: pickAuthResult(blob, "spf"),
    dkim: pickAuthResult(blob, "dkim"),
    dmarc: pickAuthResult(blob, "dmarc")
  };
}

/**
 * Extracts the bulk-sender / mailing-list disclosure headers (`List-Unsubscribe`,
 * `List-Unsubscribe-Post`, `List-Id`). Returns `null` when no headers were
 * provided at all — vs. a populated object with everything `false` / `null`
 * when headers were present but these specific fields were absent (which is
 * the case the UI wants to flag, since "no built-in unsubscribe" hurts
 * deliverability).
 *
 * Two header shapes are accepted:
 *
 *  1. Standard RFC 2369 / 8058 form, where the headers are present verbatim
 *     as `list-unsubscribe: <https://…>, <mailto:…>` etc.
 *
 *  2. Resend's `email.received` shape, where the inbound parser (postal-mime)
 *     groups all `List-*` headers under a single normalised `list` key whose
 *     value is a JSON-encoded structured object:
 *
 *       {
 *         "unsubscribe":      { "url": "...", "mail": "...", "name": "..." },
 *         "unsubscribe-post": { "name": "List-Unsubscribe=One-Click" },
 *         "id":               { "id": "...", "name": "..." }
 *       }
 *
 *     The `mail` field is the address-only form (no `mailto:` prefix); we
 *     re-add the scheme for symmetry with the RFC 2369 case. The `name`
 *     field is sometimes the original RFC 2047 quoted-printable encoded
 *     header line (Klaviyo / sparkpost do this); we decode it and recover
 *     the underlying URL/mailto so we don't false-negative those senders.
 */
export function extractListHeaders(
  headers: Record<string, string> | null
): ListHeaders | null {
  if (!headers) {
    return null;
  }

  const lookup: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === "string" && typeof value === "string") {
      lookup[key.toLowerCase()] = value;
    }
  }

  let hasListUnsubscribe = false;
  let unsubscribeMailto: string | null = null;
  let unsubscribeUrl: string | null = null;
  let hasOneClickPost = false;
  let listIdValue: string | null = null;

  // (2) Resend's parsed `list` blob — preferred when present because it has
  // already been normalised by the inbound MIME parser.
  const parsedList = tryParseJsonObject(lookup["list"]);
  if (parsedList) {
    const unsub = readObject(parsedList, "unsubscribe");
    if (unsub) {
      const urlField = readString(unsub, "url");
      const mailField = readString(unsub, "mail");
      if (urlField) {
        unsubscribeUrl = urlField.trim() || null;
      }
      if (mailField) {
        const trimmed = mailField.trim();
        if (trimmed) {
          unsubscribeMailto = trimmed.toLowerCase().startsWith("mailto:")
            ? trimmed
            : `mailto:${trimmed}`;
        }
      }
      // Some senders emit RFC 2047 encoded-word values for List-Unsubscribe
      // (Klaviyo wraps the entire `<https://…>` URI in `=?us-ascii?Q?…?=`
      // chunks). postal-mime can't always decode them and surfaces the raw
      // encoded text as `unsubscribe.name`. Recover the URI ourselves so
      // those senders aren't misreported as missing the header.
      if (!unsubscribeUrl || !unsubscribeMailto) {
        const nameField = readString(unsub, "name");
        if (nameField) {
          const decoded = decodeRfc2047(nameField);
          if (!unsubscribeUrl) {
            const httpsMatch = decoded.match(/https?:\/\/[^\s<>"',]+/i);
            if (httpsMatch) {
              unsubscribeUrl = stripTrailingPunctuation(httpsMatch[0]);
            }
          }
          if (!unsubscribeMailto) {
            const mailtoMatch = decoded.match(/mailto:[^\s<>"',]+/i);
            if (mailtoMatch) {
              unsubscribeMailto = stripTrailingPunctuation(mailtoMatch[0]);
            }
          }
        }
      }
      // Apple Mail's "This message is from a mailing list" disclosure +
      // Unsubscribe button only require the header itself to be non-empty
      // (RFC 2369). Even when we can't recover a parseable URI, the
      // recipient's mail client still rendered it, so flag the header as
      // present whenever the parsed blob carried any unsubscribe payload.
      if (
        unsubscribeUrl ||
        unsubscribeMailto ||
        readString(unsub, "name")
      ) {
        hasListUnsubscribe = true;
      }
    }

    const post = readObject(parsedList, "unsubscribe-post");
    if (post) {
      const postName = readString(post, "name");
      if (postName && ONE_CLICK_RE.test(postName)) {
        hasOneClickPost = true;
      }
    }

    const idObj = readObject(parsedList, "id");
    if (idObj) {
      const idValue = readString(idObj, "id") ?? readString(idObj, "name");
      if (idValue) {
        listIdValue = parseListId(idValue);
      }
    }
  }

  // (1) Standard RFC 2369 / 8058 form. We still consult these fields when
  // the parsed blob is missing or partial, both for robustness across
  // inbound providers and so the unit-test fixtures (which use the raw
  // shape) keep working unchanged.
  const rawListUnsubscribe = (lookup["list-unsubscribe"] ?? "").trim();
  const rawListUnsubscribePost = (lookup["list-unsubscribe-post"] ?? "").trim();
  const rawListId = (lookup["list-id"] ?? "").trim();

  if (rawListUnsubscribe.length > 0) {
    hasListUnsubscribe = true;
    if (!unsubscribeMailto) {
      unsubscribeMailto = parseListUnsubscribeUri(rawListUnsubscribe, "mailto");
    }
    if (!unsubscribeUrl) {
      unsubscribeUrl = parseListUnsubscribeUri(rawListUnsubscribe, "http");
    }
  }

  if (!hasOneClickPost && ONE_CLICK_RE.test(rawListUnsubscribePost)) {
    hasOneClickPost = true;
  }

  if (!listIdValue && rawListId.length > 0) {
    listIdValue = parseListId(rawListId);
  }

  return {
    has_list_unsubscribe: hasListUnsubscribe,
    unsubscribe_mailto: unsubscribeMailto,
    unsubscribe_url: unsubscribeUrl,
    has_one_click_post: hasOneClickPost,
    list_id: listIdValue
  };
}

// RFC 8058 §3.1 — the post body is exactly `List-Unsubscribe=One-Click`, but
// real-world senders pad it with whitespace and casing varies, so we match
// case-insensitively against the canonical token pair.
const ONE_CLICK_RE = /\blist-unsubscribe\s*=\s*one-click\b/i;

const ANGLE_BRACKETED_RE = /<([^>]+)>/g;

function parseListUnsubscribeUri(value: string, scheme: "mailto" | "http"): string | null {
  if (!value) return null;
  const matcher = scheme === "mailto" ? /^mailto:/i : /^https?:\/\//i;
  for (const match of value.matchAll(ANGLE_BRACKETED_RE)) {
    const uri = match[1].trim();
    if (matcher.test(uri)) {
      return uri;
    }
  }
  return null;
}

function parseListId(value: string): string | null {
  if (!value) return null;
  // RFC 2919: List-Id = ["display-label" SP] "<" list-id ">"
  // e.g. `"Brand Newsletter" <newsletter.brand.com>` or just `<news.brand.com>`.
  // Some senders omit the angle brackets — accept that too, stripping the
  // optional quoted label first.
  const angle = value.match(/<([^>]+)>/);
  if (angle) {
    const inner = angle[1].trim();
    return inner.length > 0 ? inner : null;
  }
  const stripped = value.replace(/^"[^"]*"\s*/, "").trim();
  return stripped.length > 0 ? stripped : null;
}

function tryParseJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON — fall through */
  }
  return null;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readObject(
  obj: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = obj[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

const RFC2047_ENCODED_WORD_RE = /=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g;

/**
 * Minimal RFC 2047 encoded-word decoder for the Q-encoded subset that
 * shows up in `List-Unsubscribe` headers (Klaviyo / sparkpost wrap their
 * `<https://…>` URIs in chunks like `=?us-ascii?Q?=3Chttps=3A=2F=2F…?=`).
 *
 * Supports Q-encoding (`=XX` hex bytes, `_` → space). Falls back to
 * returning the input unchanged when the encoded word can't be decoded —
 * we'd rather lose a fancy parse than crash the metadata extraction.
 *
 * Adjacent encoded words separated only by whitespace have their
 * inter-word whitespace dropped, per the RFC, so the embedded URI is
 * reassembled cleanly.
 */
function decodeRfc2047(value: string): string {
  if (!value || !value.includes("=?")) {
    return value;
  }
  let out = "";
  let lastIndex = 0;
  let lastWasEncodedWord = false;
  RFC2047_ENCODED_WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RFC2047_ENCODED_WORD_RE.exec(value)) !== null) {
    const between = value.slice(lastIndex, match.index);
    if (lastWasEncodedWord && /^\s+$/.test(between)) {
      // Whitespace between two encoded-words is purely structural — drop it.
    } else {
      out += between;
    }
    const encoding = match[2].toUpperCase();
    const payload = match[3];
    if (encoding === "Q") {
      out += decodeQEncoded(payload);
    } else {
      // Base64 ("B") encoded-words are rare in List-Unsubscribe; if we hit
      // one, keep the raw token rather than guessing at the charset.
      out += match[0];
    }
    lastIndex = match.index + match[0].length;
    lastWasEncodedWord = true;
  }
  out += value.slice(lastIndex);
  return out;
}

function decodeQEncoded(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "_") {
      out += " ";
      continue;
    }
    if (ch === "=" && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[<>,.;:!?)\]}'"]+$/u, "");
}

const AUTH_VALUES = new Set([
  "pass",
  "fail",
  "neutral",
  "softfail",
  "temperror",
  "permerror",
  "none"
]);

function pickAuthResult(blob: string, mechanism: "spf" | "dkim" | "dmarc"): AuthResults["spf"] {
  const re = new RegExp(`${mechanism}\\s*=\\s*([a-z]+)`, "i");
  const match = blob.match(re);
  if (!match) {
    return null;
  }
  const value = match[1].toLowerCase();
  return AUTH_VALUES.has(value) ? (value as AuthResults["spf"]) : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  if (!text) {
    return 0;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function countEmoji(text: string): number {
  if (!text) {
    return 0;
  }
  let count = 0;
  for (const ch of text) {
    if (/\p{Extended_Pictographic}/u.test(ch)) {
      count += 1;
    }
  }
  return count;
}

function uniqueLowercase(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const lower = value.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(lower);
    }
  }
  return out;
}

function isNonNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
