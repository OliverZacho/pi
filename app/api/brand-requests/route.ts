import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  createBrandRequestInDb,
  MAX_BRAND_REQUEST_FIELD
} from "@/lib/brand-requests-db";

/**
 * POST `/api/brand-requests` — public endpoint for the "Request a brand"
 * forms on Explore and the Brands page. Visitors may be logged out, so the
 * insert runs through the service-role client (RLS allows service_role only).
 * Operators triage the rows from the admin Create tab.
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
    const supabase = getSupabaseAdmin();
    await createBrandRequestInDb(supabase, { companyName, website });
  } catch (error) {
    console.error("Failed to record brand request", error);
    return NextResponse.json(
      { error: "We couldn't submit your request right now. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
