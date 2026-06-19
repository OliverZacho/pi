/**
 * Tiny helpers for turning an ISO 3166-1 alpha-2 country code (as stored in
 * `captured_emails.detected_country` / `companies.primary_market_country`) into
 * something human-readable, without shipping a country table.
 *
 * The flag is derived arithmetically from the two letters (regional indicator
 * symbols), and the name comes from `Intl.DisplayNames`, which is available in
 * both Node and the browser. Anything that isn't a clean two-letter code falls
 * back to the raw input so callers never render `undefined`.
 */

function isAlpha2(code: string): code is string {
  return /^[A-Za-z]{2}$/.test(code);
}

/** Regional-indicator flag emoji for a country code, e.g. "DK" → 🇩🇰. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !isAlpha2(code)) return "";
  const cc = code.toUpperCase();
  return String.fromCodePoint(
    ...[...cc].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65))
  );
}

let regionNames: Intl.DisplayNames | null | undefined;
function getRegionNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  return regionNames;
}

/** English country name for a code, e.g. "DK" → "Denmark". Falls back to the code. */
export function countryName(code: string | null | undefined): string {
  if (!code || !isAlpha2(code)) return code ?? "";
  const cc = code.toUpperCase();
  try {
    return getRegionNames()?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Flag + name, e.g. "DK" → "🇩🇰 Denmark". Empty string for an empty/invalid code. */
export function countryLabel(code: string | null | undefined): string {
  if (!code || !isAlpha2(code)) return "";
  return `${countryFlag(code)} ${countryName(code)}`.trim();
}

/* -------------------------------------------------------------------------
   Time-zone grouping
   -------------------------------------------------------------------------
   For comparing *send time and cadence*, what matters is the audience's wall
   clock, not the political border. Denmark and Sweden are two countries but one
   time zone (Central European Time, with identical EU daylight-saving), so a
   09:00 send means the same thing in both — they should compare like-for-like.
   We map the markets this product actually sees to a representative IANA zone
   and reduce each to a winter/summer offset signature; countries that agree on
   both keep the same wall clock all year. Anything we don't recognise returns
   null and is treated as its own group by callers (conservative). */

const COUNTRY_ZONE: Record<string, string> = {
  // Western European Time (UTC+0 / +1 DST)
  GB: "Europe/London",
  IE: "Europe/Dublin",
  PT: "Europe/Lisbon",
  IS: "Atlantic/Reykjavik",
  // Central European Time (UTC+1 / +2 DST)
  DK: "Europe/Copenhagen",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DE: "Europe/Berlin",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  LU: "Europe/Luxembourg",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  CH: "Europe/Zurich",
  AT: "Europe/Vienna",
  PL: "Europe/Warsaw",
  CZ: "Europe/Prague",
  SK: "Europe/Bratislava",
  HU: "Europe/Budapest",
  SI: "Europe/Ljubljana",
  HR: "Europe/Zagreb",
  // Eastern European Time (UTC+2 / +3 DST)
  FI: "Europe/Helsinki",
  EE: "Europe/Tallinn",
  LV: "Europe/Riga",
  LT: "Europe/Vilnius",
  GR: "Europe/Athens",
  RO: "Europe/Bucharest",
  BG: "Europe/Sofia",
  // North America (representative zone — Eastern)
  US: "America/New_York",
  CA: "America/Toronto",
  // Other common markets
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  JP: "Asia/Tokyo",
  CN: "Asia/Shanghai",
  IN: "Asia/Kolkata",
  AE: "Asia/Dubai",
  SG: "Asia/Singapore",
  BR: "America/Sao_Paulo"
};

// Two fixed probe instants so we capture both the standard and the DST offset.
// Using fixed dates (not "now") keeps the result deterministic across server and
// client renders.
const WINTER_PROBE = new Date(Date.UTC(2024, 0, 15));
const SUMMER_PROBE = new Date(Date.UTC(2024, 6, 15));

function zoneOffsetMinutes(zone: string, at: Date): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const p = Object.fromEntries(
      dtf.formatToParts(at).map((part) => [part.type, part.value])
    );
    const asUTC = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second)
    );
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

/**
 * A winter/summer UTC-offset signature for a country's representative time zone,
 * e.g. "DK" → "60/120". Countries with the same signature share a wall clock all
 * year and are like-for-like for send-time comparisons. Returns null for codes we
 * don't map, so callers can treat them as their own group.
 */
export function countryZoneSignature(
  code: string | null | undefined
): string | null {
  if (!code || !isAlpha2(code)) return null;
  const zone = COUNTRY_ZONE[code.toUpperCase()];
  if (!zone) return null;
  const winter = zoneOffsetMinutes(zone, WINTER_PROBE);
  const summer = zoneOffsetMinutes(zone, SUMMER_PROBE);
  if (winter === null || summer === null) return null;
  return `${winter}/${summer}`;
}
