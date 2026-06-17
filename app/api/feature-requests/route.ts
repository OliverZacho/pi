import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientRateKey } from "@/lib/rate-limit";
import { MAX_FEATURE_REQUEST_MESSAGE } from "@/lib/feature-requests-db";

/**
 * POST `/api/feature-requests` — endpoint for the "Request a feature" form in
 * the account menu. Operators triage the rows from the admin Feedback tab.
 *
 * The write goes through the `record_feature_request` SECURITY DEFINER
 * function via the ordinary cookie-scoped client — deliberately NOT the
 * service role. This route is unauthenticated, so it holds no elevated
 * credential: the function is the only write path, it can only insert into
 * `feature_requests`, and it stamps the caller's own `auth.uid()` + email.
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
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_feature_request", {
      p_message: message,
      p_client_key: clientRateKey(request)
    });
    if (error) throw error;
    if (data === "rate_limited") {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a few minutes." },
        { status: 429 }
      );
    }
  } catch (error) {
    console.error("Failed to record feature request", error);
    return NextResponse.json(
      { error: "We couldn't submit your request right now. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
