import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/admin-stats";
import { requireAdminSession } from "@/lib/require-admin-api";

export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const stats = await getDashboardStats(session.supabase);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Failed to load dashboard stats", error);
    return NextResponse.json({ error: "Failed to load dashboard stats" }, { status: 500 });
  }
}
