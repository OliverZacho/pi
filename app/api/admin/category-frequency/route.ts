import { NextResponse } from "next/server";
import { getCategoryFrequency } from "@/lib/admin-stats";
import { requireAdminSession } from "@/lib/require-admin-api";

export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const series = await getCategoryFrequency(session.supabase);
    return NextResponse.json({ series });
  } catch (error) {
    console.error("Failed to load category frequency", error);
    return NextResponse.json(
      { error: "Failed to load category frequency" },
      { status: 500 }
    );
  }
}
