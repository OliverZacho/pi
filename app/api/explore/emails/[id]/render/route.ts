import { NextResponse } from "next/server";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { rewriteEmailHtml } from "@/lib/email-render";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET `/api/explore/emails/[id]/render`
 *
 * Public mirror of `/api/admin/emails/[id]/render`, used by the logged-out /
 * unpaid Explore teaser. Modeled on the shared-collection render route:
 *  - open to anyone (the teaser is part of the funnel, no account needed);
 *  - serves any captured email so whole-archive teaser results render
 *    (product decision — see the plan's exposure note; restrict to
 *    `isCuratedEmail` here to shrink the public surface);
 *  - always strips links (read-only by design; only the admin route
 *    supports `?keepLinks=1`).
 *
 * Reads run through the service-role client so emails are reachable
 * regardless of row-level security on `captured_emails`.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  let email;
  try {
    email = await getEmailDetailFromDb(admin, id);
  } catch (error) {
    console.error("Failed to load email for public render", error);
    return NextResponse.json(
      { error: "Failed to load email" },
      { status: 500 }
    );
  }

  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const signedAssets = email.imageSignedUrls.reduce<Record<string, string>>(
    (acc, asset) => {
      acc[asset.storagePath] = asset.signedUrl;
      return acc;
    },
    {}
  );

  const { html } = rewriteEmailHtml(email.htmlContent, {
    mirrorMap: email.imageMirrorMap,
    signedAssets,
    stripLinks: true
  });

  const document = wrapHtml(html, email.subject);

  return new NextResponse(document, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Output depends only on the email id (signed asset URLs are memoised
      // with a 7-day TTL) and the route is public, so let the edge serve
      // repeats — same approach as the shared-collection render route.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function wrapHtml(body: string, subject: string): string {
  const looksLikeFullDocument = /<html[\s>]/i.test(body);
  if (looksLikeFullDocument) {
    return body;
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(subject || "Captured email")}</title>
    <style>
      body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #ffffff; }
      img { max-width: 100%; height: auto; }
      a { color: #086e4b; }
    </style>
  </head>
  <body>
${body}
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
