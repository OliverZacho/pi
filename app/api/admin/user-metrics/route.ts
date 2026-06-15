import { NextResponse } from "next/server";
import { getUserMetrics } from "@/lib/admin-stats";
import { requireAdminSession } from "@/lib/require-admin-api";

export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const metrics = await getUserMetrics(session.supabase);
    return NextResponse.json(metrics);
  } catch (error) {
    console.error("Failed to load user metrics", error);
    return NextResponse.json({ error: "Failed to load user metrics" }, { status: 500 });
  }
}
