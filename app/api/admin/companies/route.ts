import { NextResponse } from "next/server";
import { createCompanySubscriptionInDb } from "@/lib/admin-db";

type CreateCompanyBody = {
  name?: string;
  domain?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateCompanyBody;
    const name = body.name?.trim();
    const domain = body.domain?.trim();

    if (!name || !domain) {
      return NextResponse.json({ error: "name and domain are required" }, { status: 400 });
    }

    const company = await createCompanySubscriptionInDb({ name, domain });
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    console.error("Failed to create company", error);
    return NextResponse.json({ error: "Failed to create company subscription" }, { status: 500 });
  }
}
