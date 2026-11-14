import { createHash } from "crypto";

/**
 * Derives a stable, non-reversible per-client key from the request IP, used to
 * coarsely rate-limit the public (unauthenticated) request forms against bot
 * spam. The IP is hashed here so the raw address never leaves this process or
 * lands in the database — only the digest is sent to the rate-limit function.
 *
 * On Vercel `x-forwarded-for` is always set by the edge; the `x-real-ip` and
 * "noip" fallbacks only matter in local/dev or unusual proxy setups, where a
 * shared bucket is an acceptable (fail-safe) degradation.
 */
export function clientRateKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "noip";
  return createHash("sha256").update(ip).digest("hex");
}

/**
 * A coarse in-memory throttle for public endpoints: at most `limit` calls
 * per `windowMs` for one key (use {@link clientRateKey}).
 *
 * Counts live in this server instance only, so the real ceiling is `limit`
 * times however many instances are warm. That is enough to stop one client
 * from hammering an expensive route; it is not an exact quota. Anything
 * that must hold across instances belongs in the database instead (see
 * `record_feature_request`).
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}): (key: string) => boolean {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  return (key) => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt < now) {
      buckets.set(key, { count: 1, expiresAt: now + options.windowMs });
      // Expired entries are only swept once the map is large, so a quiet
      // instance never pays for it.
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) if (v.expiresAt < now) buckets.delete(k);
      }
      return true;
    }
    bucket.count += 1;
    return bucket.count <= options.limit;
  };
}
