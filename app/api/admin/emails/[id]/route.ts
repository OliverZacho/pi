import { NextResponse } from "next/server";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  try {
    const email = await getEmailDetailFromDb(session.supabase, id);
    if (!email) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    return NextResponse.json({ email });
  } catch (error) {
    console.error("Failed to load email detail", error);
    return NextResponse.json({ error: "Failed to load email detail" }, { status: 500 });
  }
}
