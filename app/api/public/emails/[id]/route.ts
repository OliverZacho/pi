import { NextResponse } from "next/server";
import { getViewer } from "@/lib/access";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { stripEmailLinks } from "@/lib/email-render";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Public (no-auth) email detail for the logged-out / unpaid preview modal.
 * Returns the same metadata panel the authenticated modal shows (category,
 * ESP, design, deliverability, etc.) via the service-role client.
 *
 * The modal's Text and HTML tabs both derive from `htmlContent`, and the
 * source is part of what everyone comes here to read — so it ships to every
 * viewer. What stays paid is the *destinations*: without archive access the
 * HTML comes back through {@link stripEmailLinks} (same neutralisation the
 * preview iframe applies) and the primary CTA URL is withheld. Entitled
 * viewers get the untouched source and the CTA.
 *
 * The preview iframe renders separately via
 * `/api/explore/emails/[id]/render`.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  try {
    // Reads run service-role (the archive is browsable without an account);
    // the viewer lookup only decides whether links survive.
    const [viewer, email] = await Promise.all([
      getViewer(),
      getEmailDetailFromDb(getSupabaseAdmin(), id)
    ]);
    if (!email) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    if (viewer?.hasAccess) {
      return NextResponse.json({ email });
    }
    const publicEmail = {
      ...email,
      htmlContent: stripEmailLinks(email.htmlContent).html,
      primaryCtaUrl: null
    };
    return NextResponse.json({ email: publicEmail });
  } catch (error) {
    console.error("Failed to load public email detail", error);
    return NextResponse.json(
      { error: "Failed to load email detail" },
      { status: 500 }
    );
  }
}
