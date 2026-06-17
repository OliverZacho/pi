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
