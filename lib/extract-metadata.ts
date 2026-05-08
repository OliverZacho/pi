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
  utm_index: ParsedLink["utm"][];
  subject_metadata: SubjectMetadata;
  auth_results: AuthResults | null;
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
    utm_index,
    subject_metadata: subjectMeta,
    auth_results: extractAuthResults(input.headers ?? null)
  };
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
