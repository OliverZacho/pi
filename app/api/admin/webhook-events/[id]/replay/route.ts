import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await session.supabase
    .from("webhook_events")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("Failed to load webhook event for replay", fetchError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Webhook event not found" }, { status: 404 });
  }

  if (existing.status === "processing") {
    return NextResponse.json(
      { error: "Event is currently processing; wait for it to complete before replaying" },
      { status: 409 }
    );
  }

  const { data: updated, error: updateError } = await session.supabase
    .from("webhook_events")
    .update({
      status: "received",
      last_error: null,
      processed_at: null
    })
    .eq("id", id)
    .select("id, status, attempt_count")
    .single();

  if (updateError) {
    console.error("Failed to enqueue replay", updateError);
    return NextResponse.json({ error: "Failed to enqueue replay" }, { status: 500 });
  }

  return NextResponse.json({ event: updated }, { status: 200 });
}
