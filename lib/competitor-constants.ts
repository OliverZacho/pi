/**
 * Maximum number of brands allowed in a single comparison / competitor set.
 *
 * Lives in its own dependency-free module so client components can import the
 * limit without pulling in competitor-db's server-only transitive deps
 * (storage → supabase-admin, which is `server-only`). competitor-db re-exports
 * it for server-side callers.
 */
export const MAX_BRANDS_PER_COMPARISON = 20;
