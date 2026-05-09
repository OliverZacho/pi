import { NextResponse } from "next/server";
import { createCompanySubscriptionInDb } from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type CreateCompanyBody = {
  name?: string;
  domain?: string;
  market?: string | null;
};

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const body = (await request.json()) as CreateCompanyBody;
    const name = body.name?.trim();
    const domain = body.domain?.trim();
    const market = typeof body.market === "string" ? body.market.trim() : null;

    if (!name || !domain) {
      return NextResponse.json({ error: "name and domain are required" }, { status: 400 });
    }

    const company = await createCompanySubscriptionInDb(session.supabase, {
      name,
      domain,
      market: market && market.length > 0 ? market : null
    });
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    console.error("Failed to create company", error);
    return NextResponse.json({ error: "Failed to create company subscription" }, { status: 500 });
  }
}
