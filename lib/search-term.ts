/**
 * Shared search-term preparation for the email search used by Explore
 * (`searchExploreEmails`) and by smart-collection `search` rules.
 *
 * ## How email search works
 *
 * Marketing HTML is full of typographic characters that are invisible on
 * screen but are distinct codepoints in the database: non-breaking spaces
 * (U+00A0), narrow no-break spaces (U+202F), curly apostrophes (U+2019),
 * zero-width spaces (U+200B), soft hyphens (U+00AD). A body reading
 * `Copenhagen Fashion Week` can hold U+202F between two of those words, so
 * a naive `ILIKE '%Copenhagen Fashion Week%'` silently misses it.
 *
 * We used to bridge the gap at query time with a `~*` regex whose separator
 * class accepted every space and apostrophe variant. That regex cost ~1s per
 * term against the trigram index (vs ~90ms for ilike, measured 2026-08-22 at
 * ~7k emails) because the recheck runs the regex over full email bodies —
 * enough to push smart-collection evaluation past the authenticated role's
 * 8s statement timeout and 500 the collection page.
 *
 * The normalization now happens at WRITE time instead: a trigger on
 * `captured_emails` maintains `search_text`, the four searched columns
 * (subject, preheader, primary CTA text, plain text) concatenated with
 * invisible characters stripped and every separator run collapsed to a
 * single space (`email_search_text()` in the DB — it must stay in lockstep
 * with the character classes below). Every query is then one cheap `ilike`
 * against that single column, and displayed columns keep their original
 * typography.
 *
 * ## Brand names
 *
 * `companies.name` is raw text with no normalized twin, so brand-name
 * lookups still use a separator-tolerant `~*` regex (`nameRegex`). The
 * companies table is small; the regex is cheap there.
 */

/**
 * PostgREST's `or()` is a comma-separated list of `column.op.value` triples
 * wrapped in parentheses, so bare commas, parentheses and double quotes in
 * a value break the parser. Replaced with a space, which makes them behave
 * as word separators.
 */
const OR_SYNTAX = /[,()"]/g;

/**
 * Invisible characters removed entirely (not treated as separators): they
 * are inserted INSIDE words (`F​ree`), so stripping them rejoins the
 * word. Mirrors the strip class in the DB's `email_search_text()`.
 */
const STRIP_RUN = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;

/**
 * A run of anything separating two words. `\s` in JavaScript already covers
 * U+00A0, U+202F, U+2009 and the other Unicode space separators; the
 * explicit additions are the apostrophe variants, so `don't` matches a body
 * written `don’t` and vice versa. Mirrors the separator class in the DB's
 * `email_search_text()`.
 */
const SEPARATOR_RUN = /[\s'‘’ʼ´`]+/g;

/**
 * The Postgres-side counterpart of `SEPARATOR_RUN`, used only for the
 * brand-name regex. `[[:space:]]` matches the Unicode space separators
 * (verified against U+00A0 and U+202F in this database's collation); the
 * listed apostrophes mirror the JS class above. Contains no `,` `(` `)` so
 * it is safe inside an `or()` string.
 */
const SEPARATOR_CLASS = "[[:space:]'‘’ʼ´`]+";

/** Characters with meaning in a POSIX extended regular expression. */
const REGEX_METACHARS = /[\\.\[\]{}()*+?|^$]/g;

/** Characters with meaning in a LIKE/ILIKE pattern. */
const LIKE_METACHARS = /[\\%_]/g;

export type SearchMatcher = {
  /**
   * ILIKE fragment for the normalized `search_text` column — words joined
   * by single spaces, LIKE wildcards escaped. Callers wrap it in their own
   * wildcards (`%…%` for the client methods, `*…*` inside an `or()`
   * string).
   */
  pattern: string;
  /**
   * Separator-tolerant case-insensitive POSIX regex for raw (unnormalized)
   * text columns — currently only `companies.name`. Needs no wrapping
   * because a regex match is already unanchored.
   */
  nameRegex: string;
};

/**
 * Turn raw user input into the two match patterns, or `null` when the
 * input holds nothing searchable (callers treat that as "no search term").
 */
export function buildSearchMatcher(input: string): SearchMatcher | null {
  const words = input
    .replace(STRIP_RUN, "")
    .replace(OR_SYNTAX, " ")
    .split(SEPARATOR_RUN)
    .filter(Boolean);

  if (words.length === 0) return null;

  return {
    pattern: words.map((word) => word.replace(LIKE_METACHARS, "\\$&")).join(" "),
    nameRegex: words
      .map((word) => word.replace(REGEX_METACHARS, "\\$&"))
      .join(SEPARATOR_CLASS)
  };
}

/**
 * Convenience for the query builders: the ILIKE value for `search_text`,
 * wrapped in the caller's wildcard character (`%` for client methods, `*`
 * inside an `or()` string, which PostgREST treats as the same thing).
 */
export function matcherValue(matcher: SearchMatcher, wildcard: "%" | "*"): string {
  return `${wildcard}${matcher.pattern}${wildcard}`;
}
