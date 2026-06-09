import { NextResponse } from "next/server";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Public (no-auth) email detail for the logged-out / unpaid preview modal.
 * Returns the same metadata panel the authenticated modal shows (category,
 * ESP, design, deliverability, etc.) via the service-role client — but with
 * the raw HTML source and the primary CTA destination stripped, so anonymous
 * visitors get the *analysis* without the underlying links/source. The
 * preview iframe (links already stripped) renders via
 * `/api/explore/emails/[id]/render`.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  try {
    const email = await getEmailDetailFromDb(getSupabaseAdmin(), id);
    if (!email) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    // Strip the raw-link surfaces; keep all derived metadata.
    const publicEmail = { ...email, htmlContent: "", primaryCtaUrl: null };
    return NextResponse.json({ email: publicEmail });
  } catch (error) {
    console.error("Failed to load public email detail", error);
    return NextResponse.json(
      { error: "Failed to load email detail" },
      { status: 500 }
    );
  }
}
