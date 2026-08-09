/**
 * The free tier's only rules are numeric caps: a signed-in user without
 * archive entitlement may hold up to N of a thing (saves, follows,
 * collections, comparisons), after which the API refuses with a 409 the
 * client turns into an upgrade nudge.
 *
 * The decision is pure so every cap can be unit-tested without a DB, and
 * shared so the boundary semantics (`count >= limit` blocks, idempotent
 * repeats never blocked) can't drift between features. Entitled users
 * bypass these checks entirely — routes only consult a quota when
 * `hasAccess` is false.
 */

export const FREE_QUOTA_CODES = [
  "SAVE_LIMIT_REACHED",
  "FOLLOW_LIMIT_REACHED",
  "COLLECTION_LIMIT_REACHED",
  "COMPARISON_LIMIT_REACHED"
] as const;

export type FreeQuotaCode = (typeof FREE_QUOTA_CODES)[number];

export type FreeQuotaDecision =
  | { ok: true }
  | { ok: false; status: 409; code: FreeQuotaCode; error: string };

export function freeQuotaDecision(input: {
  /**
   * The user already holds this exact item (re-save, re-follow). Repeats
   * are idempotent no-ops and must never be blocked by the cap, so a
   * retried PUT can't error.
   */
  alreadyPresent: boolean;
  count: number;
  limit: number;
  code: FreeQuotaCode;
  /** User-facing message returned with the 409. */
  error: string;
}): FreeQuotaDecision {
  if (input.alreadyPresent) {
    return { ok: true };
  }
  if (input.count >= input.limit) {
    return { ok: false, status: 409, code: input.code, error: input.error };
  }
  return { ok: true };
}
