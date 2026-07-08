/**
 * Creates Pirol's Stripe products and recurring prices, idempotently.
 *
 * The entitlement backbone already exists in the DB (`public.subscriptions` +
 * `has_archive_access()`); Stripe's only job is to sell the plans and let the
 * webhook populate that table. This script defines the catalogue — two products
 * (Solo, Team), each with a monthly and a yearly EUR price — so the price IDs
 * are reproducible and version-controlled instead of hand-clicked in the
 * dashboard.
 *
 * Idempotent: products are matched by their `plan` metadata and prices by a
 * stable `lookup_key`, so re-running reuses existing objects instead of
 * duplicating them. After a successful run it writes the four resolved price
 * IDs back into the `STRIPE_PRICE_*` blanks in `.env.local`.
 *
 * Run with:
 *   npx --yes tsx scripts/stripe-seed.ts            # uses STRIPE_SECRET_KEY (test)
 *   npx --yes tsx scripts/stripe-seed.ts --live     # required to touch a live key
 *
 * Safety: refuses to run against an `sk_live_` key unless `--live` is passed,
 * so the default invocation can only ever create test-mode objects.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";

type PriceSpec = {
  lookupKey: string;
  nickname: string;
  interval: "month" | "year";
  /** Amount in the currency's minor unit (cents). €30.00 -> 3000. */
  unitAmount: number;
  /** The `.env.local` variable this price ID is written back into. */
  envVar: string;
};

type PlanSpec = {
  /** Matches `subscriptions.plan` and the webhook's plan mapping. */
  plan: "solo" | "team";
  name: string;
  description: string;
  seats: number;
  prices: PriceSpec[];
};

const CURRENCY = "eur";

// €300 / €900 yearly = 10× monthly, i.e. "two months free" (the pricing copy).
const PLANS: PlanSpec[] = [
  {
    plan: "solo",
    name: "Pirol Solo",
    description:
      "Full archive access for one user. Unlimited search, saves, collections, brand comparison and analytics dashboards.",
    seats: 1,
    prices: [
      {
        lookupKey: "pirol_solo_monthly",
        nickname: "Solo — Monthly",
        interval: "month",
        unitAmount: 3000,
        envVar: "STRIPE_PRICE_SOLO_MONTHLY",
      },
      {
        lookupKey: "pirol_solo_yearly",
        nickname: "Solo — Yearly",
        interval: "year",
        unitAmount: 30000,
        envVar: "STRIPE_PRICE_SOLO_YEARLY",
      },
    ],
  },
  {
    plan: "team",
    name: "Pirol Team",
    description:
      "Full archive access for up to 6 users. Everything in Solo plus shared team collections and priority support.",
    seats: 6,
    prices: [
      {
        lookupKey: "pirol_team_monthly",
        nickname: "Team — Monthly",
        interval: "month",
        unitAmount: 9000,
        envVar: "STRIPE_PRICE_TEAM_MONTHLY",
      },
      {
        lookupKey: "pirol_team_yearly",
        nickname: "Team — Yearly",
        interval: "year",
        unitAmount: 90000,
        envVar: "STRIPE_PRICE_TEAM_YEARLY",
      },
    ],
  },
];

const ENV_PATH = resolve(process.cwd(), ".env.local");

function loadDotEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/** Find a plan's product by its `plan` metadata, or create it. */
async function ensureProduct(
  stripe: Stripe,
  spec: PlanSpec
): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `active:'true' AND metadata['plan']:'${spec.plan}'`,
    limit: 1,
  });
  if (existing.data[0]) {
    console.log(`  product ${spec.plan}: reused ${existing.data[0].id}`);
    return existing.data[0];
  }
  const product = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { plan: spec.plan, seats: String(spec.seats) },
  });
  console.log(`  product ${spec.plan}: created ${product.id}`);
  return product;
}

/**
 * Find a price by its lookup_key, or create it. Reprice-aware: Stripe prices
 * are immutable, so if a price with this lookup_key exists at a *different*
 * amount, we create a new price (transfer_lookup_key moves the key onto it) and
 * archive the old one. Existing subscriptions stay on the archived price, so
 * repricing only affects new checkouts.
 */
async function ensurePrice(
  stripe: Stripe,
  productId: string,
  spec: PriceSpec
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 1,
  });
  const current = existing.data[0];
  if (
    current &&
    current.unit_amount === spec.unitAmount &&
    current.currency === CURRENCY &&
    current.recurring?.interval === spec.interval
  ) {
    console.log(`    price ${spec.lookupKey}: reused ${current.id}`);
    return current;
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: spec.unitAmount,
    recurring: { interval: spec.interval },
    nickname: spec.nickname,
    lookup_key: spec.lookupKey,
    transfer_lookup_key: true,
  });

  if (current) {
    await stripe.prices.update(current.id, { active: false });
    console.log(
      `    price ${spec.lookupKey}: repriced ${current.id} -> ${price.id} (old archived)`
    );
  } else {
    console.log(`    price ${spec.lookupKey}: created ${price.id}`);
  }
  return price;
}

/** Write resolved price IDs back into the STRIPE_PRICE_* blanks. */
function writeEnvPriceIds(ids: Record<string, string>): void {
  let text: string;
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    console.warn("Could not read .env.local to write price IDs.");
    return;
  }
  const lines = text.split(/\r?\n/);
  for (const [envVar, value] of Object.entries(ids)) {
    const idx = lines.findIndex((l) => l.trim().startsWith(`${envVar}=`));
    const next = `${envVar}=${value}`;
    if (idx === -1) {
      lines.push(next);
    } else {
      lines[idx] = next;
    }
  }
  writeFileSync(ENV_PATH, lines.join("\n"));
  console.log("\nWrote price IDs into .env.local");
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const live = process.argv.includes("--live");
  const secretKey = requireEnv("STRIPE_SECRET_KEY");

  if (secretKey.startsWith("sk_live_") && !live) {
    console.error(
      "Refusing to run: STRIPE_SECRET_KEY is a LIVE key. Re-run with --live to confirm."
    );
    process.exit(1);
  }
  if (secretKey.startsWith("sk_test_") && live) {
    console.error("--live passed but STRIPE_SECRET_KEY is a test key. Aborting.");
    process.exit(1);
  }

  const stripe = new Stripe(secretKey);
  const mode = secretKey.startsWith("sk_live_") ? "LIVE" : "TEST";
  console.log(`Seeding Pirol catalogue in ${mode} mode...\n`);

  const ids: Record<string, string> = {};
  for (const plan of PLANS) {
    console.log(plan.name);
    const product = await ensureProduct(stripe, plan);
    for (const priceSpec of plan.prices) {
      const price = await ensurePrice(stripe, product.id, priceSpec);
      ids[priceSpec.envVar] = price.id;
    }
  }

  writeEnvPriceIds(ids);

  console.log("\nDone. Price IDs:");
  for (const [k, v] of Object.entries(ids)) {
    console.log(`  ${k}=${v}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
