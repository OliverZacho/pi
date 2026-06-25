import { NextResponse } from "next/server";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { isEmailInPublicCollection } from "@/lib/collections-db";
import { rewriteEmailHtml, emailPreviewCsp } from "@/lib/email-render";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { CARD_IMAGE_TRANSFORM } from "@/lib/storage";

const SLUG_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = {
  params: Promise<{ slug: string; id: string }>;
};

/**
 * GET `/api/c/[slug]/emails/[id]/render`
 *
 * Public-facing mirror of `/api/admin/emails/[id]/render`. Anyone with
 * the slug can request the rendered HTML for any email in that
 * collection — but **only** those emails. We verify membership against
 * `collection_emails` first so an attacker can't enumerate `captured_emails`
 * by guessing UUIDs against a known slug.
 *
 * Links are always stripped on this endpoint: only the admin variant
 * supports `?keepLinks=1`, and the share view is read-only by design.
 */
export async function GET(request: Request, context: RouteContext) {
  const { slug, id } = await context.params;

  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  let allowed = false;
  try {
    allowed = await isEmailInPublicCollection(admin, slug, id);
  } catch (error) {
    console.error("Failed to verify collection membership", error);
    return NextResponse.json(
      { error: "Failed to verify collection" },
      { status: 500 }
    );
  }
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Grid cards request `?preview=1` for CDN-resized body images; the modal
  // omits it and gets full-fidelity originals.
  const isPreview = new URL(request.url).searchParams.get("preview") === "1";

  let email;
  try {
    email = await getEmailDetailFromDb(admin, id, {
      imageTransform: isPreview ? CARD_IMAGE_TRANSFORM : undefined
    });
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
      // Public share view: the response depends only on `(slug, id,
      // variant)`, all of which are part of the URL. Let Vercel's
      // edge serve repeat hits for a day and keep the stale copy
      // around for a week while it revalidates. Combined with the
      // 7-day signed-URL TTL inside the body, this means most
      // anonymous traffic never touches our origin (or Supabase
      // Storage egress) at all.
      "Cache-Control":
        "public, s-maxage=86400, stale-while-revalidate=604800",
      // Block remote trackers/images/fonts in the preview — see emailPreviewCsp().
      "Content-Security-Policy": emailPreviewCsp(),
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
