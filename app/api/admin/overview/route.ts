import { NextResponse } from "next/server";
import { getOverviewFromDb } from "@/lib/admin-db";

export async function GET() {
  try {
    const overview = await getOverviewFromDb();
    return NextResponse.json(overview);
  } catch (error) {
    console.error("Failed to load overview", error);
    return NextResponse.json({ error: "Failed to load admin overview" }, { status: 500 });
  }
}
