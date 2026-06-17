import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientRateKey } from "@/lib/rate-limit";
import { MAX_BRAND_REQUEST_FIELD } from "@/lib/brand-requests-db";

/**
 * POST `/api/brand-requests` — public endpoint for the "Request a brand"
 * forms on Explore and the Brands page. Visitors may be logged out.
 * Operators triage the rows from the admin Create tab.
 *
 * The write goes through the `record_brand_request` SECURITY DEFINER function
 * via the ordinary cookie-scoped client — deliberately NOT the service role.
 * This route is unauthenticated and internet-facing, so it holds no elevated
 * credential: the function is the only write path, it can only insert into
 * `brand_requests`, and it stamps the caller's own `auth.uid()` (null when
 * logged out).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const companyName =
    typeof record.companyName === "string" ? record.companyName.trim() : "";
  const website =
    typeof record.website === "string" ? record.website.trim() : "";

  if (!companyName || !website) {
    return NextResponse.json(
      { error: "Company name and website are both required." },
      { status: 400 }
    );
  }
  if (
    companyName.length > MAX_BRAND_REQUEST_FIELD ||
    website.length > MAX_BRAND_REQUEST_FIELD
  ) {
    return NextResponse.json(
      { error: "That input is too long." },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_brand_request", {
      p_company_name: companyName,
      p_website: website,
      p_client_key: clientRateKey(request)
    });
    if (error) throw error;
    if (data === "rate_limited") {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a few minutes." },
        { status: 429 }
      );
    }
  } catch (error) {
    console.error("Failed to record brand request", error);
    return NextResponse.json(
      { error: "We couldn't submit your request right now. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
