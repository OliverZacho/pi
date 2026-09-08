import type { useRouter } from "next/navigation";

type AppRouter = ReturnType<typeof useRouter>;

/**
 * Land the user on `next` once their session exists (signup + login forms).
 *
 * Pages go through the app router as usual. A route handler (`/api/...`,
 * e.g. `/api/checkout/continue`, which answers with a redirect to Stripe)
 * needs a full navigation instead: the client router would fetch it as an
 * RSC payload, follow the redirect cross-origin, fail on CORS, and only then
 * fall back to a hard navigation — having already opened one Checkout
 * session it never uses.
 */
export function finishAuthRedirect(router: AppRouter, next: string): void {
  if (next.startsWith("/api/")) {
    window.location.assign(next);
    return;
  }
  router.push(next);
  router.refresh();
}
