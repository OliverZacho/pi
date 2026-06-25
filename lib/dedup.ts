/**
 * Read-path mirror of Explore's `duplicate_of IS NULL` collapse.
 *
 * Explore hides duplicate list-copies of a multi-segment send at the
 * query level. The saved gallery and collections can't do that: they
 * store *literal* `captured_emails.id`s in join tables, so a single
 * campaign blasted once per inbox segment shows up once per copy. This
 * collapses those copies in memory after the rows are fetched.
 *
 * Grouping matches the DB de-dup key: every copy carries `duplicate_of`
 * pointing at the canonical row, so `duplicate_of ?? id` is the group
 * key. The first row seen per group wins, which preserves the caller's
 * ordering — e.g. with `saved_at`/`added_at` desc the group sits where
 * its most recently added copy was.
 */
export function collapseDuplicateRows<T>(
  rows: readonly T[],
  getEmail: (
    row: T
  ) => { id: string; duplicate_of: string | null } | null | undefined
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const email = getEmail(row);
    if (!email) {
      out.push(row);
      continue;
    }
    const key = email.duplicate_of ?? email.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
