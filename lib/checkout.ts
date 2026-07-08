import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStripe, priceIdFor, type Billing, type PlanId } from "@/lib/stripe";

export const CHECKOUT_PLANS: PlanId[] = ["solo", "team"];
export const CHECKOUT_BILLINGS: Billing[] = ["monthly", "annual"];

/** Optional buyer/business details captured in the inline signup flow. */
export type BuyerDetails = {
  name?: string;
  isBusiness?: boolean;
  company?: string;
  vatNumber?: string;
  country?: string;
};

export type CheckoutResult =
  | { kind: "url"; url: string }
  | { kind: "alreadyActive" };

/** Absolute origin for return URLs, honouring proxy headers in prod. */
export function originOf(request: Request): string {
  const fromHeader = request.headers.get("origin");
  if (fromHeader) return fromHeader;
  const host = request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

/**
 * Create (or reuse) the user's Stripe customer and open a Checkout Session for
 * the given plan. Shared by `POST /api/checkout` (returns the URL as JSON) and
 * `GET /api/checkout/continue` (redirects to it after an OAuth round-trip).
 *
 * Returns `{ kind: "alreadyActive" }` when the user already has a live
 * subscription, so callers can unlock in place rather than double-charge.
 */
export async function startCheckoutSession(params: {
  userId: string;
  userEmail: string | null;
  plan: PlanId;
  billing: Billing;
  origin: string;
  buyer?: BuyerDetails;
}): Promise<CheckoutResult> {
  const { userId, userEmail, plan, billing, origin, buyer = {} } = params;
  const stripe = getStripe();
  const admin = getSupabaseAdmin();

  // Reuse this user's Stripe customer if we've seen one, else create it and
  // remember it immediately (status stays 'inactive' until the webhook confirms
  // payment) so repeat checkouts don't spawn duplicate customers.
  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_customer_id, status")
    .eq("user_id", userId)
    .maybeSingle();

  // Don't let someone who already has a live subscription buy a second one.
  if (existing?.status === "active" || existing?.status === "trialing") {
    return { kind: "alreadyActive" };
  }

  // Buyer/business details for the Stripe customer. Company name (when buying
  // as a business) takes the customer name; VAT + country ride along as
  // metadata. Proper VAT-ID validation / reverse charge is a later step.
  const trimmed = (v?: string) => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : undefined;
  };
  const customerName = buyer.isBusiness
    ? trimmed(buyer.company) ?? trimmed(buyer.name)
    : trimmed(buyer.name);
  const customerMeta: Record<string, string> = { user_id: userId };
  if (buyer.isBusiness) customerMeta.is_business = "true";
  const vat = trimmed(buyer.vatNumber);
  const country = trimmed(buyer.country);
  if (vat) customerMeta.vat_number = vat;
  if (country) customerMeta.country = country;

  let customerId = existing?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userEmail ?? undefined,
      name: customerName,
      metadata: customerMeta,
    });
    customerId = customer.id;
    await admin.from("subscriptions").upsert(
      { user_id: userId, stripe_customer_id: customerId, status: "inactive" },
      { onConflict: "user_id" }
    );
  } else if (customerName || vat || country) {
    // Returning through checkout with fresh details — keep the customer current.
    await stripe.customers.update(customerId, {
      ...(customerName ? { name: customerName } : {}),
      metadata: customerMeta,
    });
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: priceIdFor(plan, billing), quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { user_id: userId, plan } },
    // session_id lets the landing page reconcile entitlement directly with
    // Stripe (lib/stripe-sync.ts) instead of waiting on the webhook.
    success_url: `${origin}/explore?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
  });

  if (!checkout.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return { kind: "url", url: checkout.url };
}
