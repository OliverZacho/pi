/**
 * Shared search-term preparation for the email search used by Explore
 * (`searchExploreEmails`) and by smart-collection `search` rules.
 *
 * ## Why this isn't a plain ILIKE
 *
 * Marketing HTML is full of typographic characters that are invisible on
 * screen but are distinct codepoints in the database. Of 4,300 captured
 * emails at the time of writing, 1,555 bodies contain a non-breaking space
 * (U+00A0), 10 contain a narrow no-break space (U+202F), and 721 contain a
 * curly apostrophe (U+2019).
 *
 * A body reading `Copenhagen Fashion Week` can therefore hold U+202F
 * between two of those words. It renders identically to an ordinary space,
 * but `ILIKE '%Copenhagen Fashion Week%'` never matches it, so the email is
 * silently absent from results — the bug this module exists to fix.
 *
 * ## The two paths
 *
 * - **One word** → `ilike`, exactly as before. There is no separator to
 *   normalise, so the results are identical to a regex, and the trigram
 *   index recheck is roughly 7x cheaper (measured: 151ms vs 1010ms for
 *   `sale` across the four searched columns).
 *
 * - **Two or more words** → `imatch` (Postgres `~*`), joining the words
 *   with a character class that accepts any run of whitespace or
 *   apostrophes. This matches every space variant *and* keeps hyphens out.
 *
 * That last point is why this isn't done with `_`, SQL's single-character
 * wildcard. `_` would also match the hyphen in the collection-nav URLs
 * (`/collections/new-arrivals`) that sit in nearly every email footer, so
 * `new arrivals` would jump from 413 matches to 511 while only 1 of those
 * 98 was a real missed email. `black friday` would go from 0 to 7, all of
 * them `black-friday` nav links. The regex keeps precision intact and still
 * recovers the genuine misses (`don't miss` 42 → 76, `free shipping`
 * 332 → 334).
 *
 * ## Known limit
 *
 * Zero-width characters (U+200B, ~369 bodies) are *inserted* between
 * letters rather than substituted for a separator, so no separator-matching
 * scheme can absorb them. Those bodies stay unmatchable by phrase search.
 */

/**
 * PostgREST's `or()` is a comma-separated list of `column.op.value` triples
 * wrapped in parentheses, so bare commas, parentheses and double quotes in
 * a value break the parser. Replaced with a space, which makes them behave
 * as word separators.
 */
const OR_SYNTAX = /[,()"]/g;

/**
 * A run of anything separating two words. `\s` in JavaScript already covers
 * U+00A0, U+202F, U+2009 and the other Unicode space separators; the
 * explicit additions are the apostrophe variants, so `don't` matches a body
 * written `don’t` and vice versa.
 */
const SEPARATOR_RUN = /[\s'‘’ʼ´`]+/g;

/**
 * The Postgres-side counterpart of `SEPARATOR_RUN`. `[[:space:]]` matches
 * the Unicode space separators (verified against U+00A0 and U+202F in this
 * database's collation); the listed apostrophes mirror the JS class above.
 * Contains no `,` `(` `)` so it is safe inside an `or()` string.
 */
const SEPARATOR_CLASS = "[[:space:]'‘’ʼ´`]+";

/** Characters with meaning in a POSIX extended regular expression. */
const REGEX_METACHARS = /[\\.\[\]{}()*+?|^$]/g;

export type SearchMatcher = {
  /** PostgREST operator to use for every searched column. */
  operator: "ilike" | "imatch";
  /**
   * For `ilike`, the inner fragment — callers wrap it in their own
   * wildcards (`%…%` for the client methods, `*…*` inside an `or()`
   * string). For `imatch`, the complete regex, which needs no wrapping
   * because a regex match is already unanchored.
   */
  pattern: string;
};

/**
 * Turn raw user input into an operator and pattern, or `null` when the
 * input holds nothing searchable (callers treat that as "no search term").
 */
export function buildSearchMatcher(input: string): SearchMatcher | null {
  const words = input.replace(OR_SYNTAX, " ").split(SEPARATOR_RUN).filter(Boolean);

  if (words.length === 0) return null;

  // Single word with no SQL wildcards in it: nothing to normalise, so take
  // the cheaper operator. A stray `%` or `_` would be read as a wildcard
  // here, so those fall through to the regex path where they are literal.
  if (words.length === 1 && !/[%_]/.test(words[0])) {
    return { operator: "ilike", pattern: words[0] };
  }

  const escaped = words.map((word) => word.replace(REGEX_METACHARS, "\\$&"));
  return { operator: "imatch", pattern: escaped.join(SEPARATOR_CLASS) };
}

/**
 * Convenience for the `or()` builders: the value to place after the
 * operator, with ILIKE patterns wrapped in the caller's wildcard character
 * (`%` for client methods, `*` inside an `or()` string, which PostgREST
 * treats as the same thing).
 */
export function matcherValue(matcher: SearchMatcher, wildcard: "%" | "*"): string {
  return matcher.operator === "ilike"
    ? `${wildcard}${matcher.pattern}${wildcard}`
    : matcher.pattern;
}
