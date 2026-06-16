import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getViewer } from "@/lib/access";
import {
  createFeatureRequestInDb,
  MAX_FEATURE_REQUEST_MESSAGE
} from "@/lib/feature-requests-db";

/**
 * POST `/api/feature-requests` — endpoint for the "Request a feature" form in
 * the account menu. The insert runs through the service-role client (RLS
 * allows service_role only). Operators triage the rows from the admin
 * Feedback tab.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const message =
    typeof record.message === "string" ? record.message.trim() : "";

  if (!message) {
    return NextResponse.json(
      { error: "Please describe the feature you'd like." },
      { status: 400 }
    );
  }
  if (message.length > MAX_FEATURE_REQUEST_MESSAGE) {
    return NextResponse.json(
      { error: "That message is too long." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    // Attach the signed-in requester (if any) so an operator can follow up.
    const viewer = await getViewer();
    await createFeatureRequestInDb(supabase, {
      message,
      requestedBy: viewer?.userId ?? null,
      requesterEmail: viewer?.email ?? null
    });
  } catch (error) {
    console.error("Failed to record feature request", error);
    return NextResponse.json(
      { error: "We couldn't submit your request right now. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
