import { NextResponse } from "next/server";
import { createCompanySubscriptionInDb } from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type CreateCompanyBody = {
  name?: string;
  domain?: string;
  /**
   * Optional list of category tags to attach to the new brand. Empty
   * (or absent) means "uncategorised". Stored as a `text[]` on
   * `companies.markets`; the DB layer trims, lower-cases and
   * de-duplicates the values.
   */
  markets?: unknown;
  /**
   * Legacy singular field, kept temporarily for backwards compatibility
   * with any external client that still POSTs `market: "fashion"`. It
   * is folded into `markets` server-side. New clients should send
   * `markets: ["fashion"]` directly.
   */
  market?: unknown;
};

/**
 * Coerces the wire-format inputs (`markets: string[]` and the legacy
 * `market: string | null`) into the array of trimmed strings we hand to
 * the DB layer. Anything that isn't a non-empty string is dropped.
 */
function readMarketsFromBody(body: CreateCompanyBody): string[] {
  const collected: string[] = [];
  if (Array.isArray(body.markets)) {
    for (const item of body.markets) {
      if (typeof item === "string") collected.push(item);
    }
  }
  if (typeof body.market === "string" && body.market.trim().length > 0) {
    collected.push(body.market);
  }
  return collected;
}

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const body = (await request.json()) as CreateCompanyBody;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const domain = typeof body.domain === "string" ? body.domain.trim() : "";
    const markets = readMarketsFromBody(body);

    if (!name || !domain) {
      return NextResponse.json({ error: "name and domain are required" }, { status: 400 });
    }

    const company = await createCompanySubscriptionInDb(session.supabase, {
      name,
      domain,
      markets
    });
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    console.error("Failed to create company", error);
    return NextResponse.json({ error: "Failed to create company subscription" }, { status: 500 });
  }
}
