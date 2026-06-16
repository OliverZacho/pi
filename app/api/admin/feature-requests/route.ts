import { NextResponse } from "next/server";
import {
  listFeatureRequestsInDb,
  markFeatureRequestHandledInDb
} from "@/lib/feature-requests-db";
import { requireAdminSession } from "@/lib/require-admin-api";

/**
 * GET `/api/admin/feature-requests` — pending feature requests for the admin
 * Feedback tab triage block, newest first.
 */
export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const requests = await listFeatureRequestsInDb(session.supabase, {
      status: "pending"
    });
    return NextResponse.json({ requests });
  } catch (error) {
    console.error("Failed to list feature requests", error);
    return NextResponse.json(
      { error: "Failed to load feature requests" },
      { status: 500 }
    );
  }
}

/**
 * PATCH `/api/admin/feature-requests` — marks a request handled once the
 * operator has actioned or dismissed it.
 */
export async function PATCH(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id =
    typeof (body as Record<string, unknown>)?.id === "string"
      ? ((body as Record<string, unknown>).id as string)
      : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await markFeatureRequestHandledInDb(session.supabase, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update feature request", error);
    return NextResponse.json(
      { error: "Failed to update feature request" },
      { status: 500 }
    );
  }
}
