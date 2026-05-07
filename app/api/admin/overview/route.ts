import { NextResponse } from "next/server";
import { getOverviewFromDb } from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const overview = await getOverviewFromDb(session.supabase);
    return NextResponse.json(overview);
  } catch (error) {
    console.error("Failed to load overview", error);
    return NextResponse.json({ error: "Failed to load admin overview" }, { status: 500 });
  }
}
