import { NextResponse } from "next/server";
import { getCategoryCountryFrequency } from "@/lib/admin-stats";
import { requireAdminSession } from "@/lib/require-admin-api";

export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const series = await getCategoryCountryFrequency(session.supabase);
    return NextResponse.json({ series });
  } catch (error) {
    console.error("Failed to load category/country frequency", error);
    return NextResponse.json(
      { error: "Failed to load category/country frequency" },
      { status: 500 }
    );
  }
}
