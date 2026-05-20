import { NextResponse } from "next/server";
import { getEmailDetailFromDb } from "@/lib/admin-db";
import { rewriteEmailHtml } from "@/lib/email-render";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  // Admin viewer opts out of link stripping via `?keepLinks=1` so the
  // raw destinations stay clickable for inspection. Every other caller
  // (Explore grid + modal) gets the default safe behaviour where links
  // are neutralised before the iframe renders.
  const keepLinks = new URL(request.url).searchParams.get("keepLinks") === "1";

  let email;
  try {
    email = await getEmailDetailFromDb(session.supabase, id);
  } catch (error) {
    console.error("Failed to load email for render", error);
    return NextResponse.json({ error: "Failed to load email" }, { status: 500 });
  }

  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const signedAssets = email.imageSignedUrls.reduce<Record<string, string>>((acc, asset) => {
    acc[asset.storagePath] = asset.signedUrl;
    return acc;
  }, {});

  const { html } = rewriteEmailHtml(email.htmlContent, {
    mirrorMap: email.imageMirrorMap,
    signedAssets,
    stripLinks: !keepLinks
  });

  // Wrap so the inner email body always has its own document context (some
  // emails ship without a <html>/<body> wrapper) and so we can apply a tiny
  // baseline reset that matches what most webmail clients render with.
  const document = wrapHtml(html, email.subject);

  return new NextResponse(document, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      // The iframe is sandboxed at the host level, but we still set a strict
      // referrer policy to avoid leaking signed urls to remote trackers.
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
      a { color: #2563eb; }
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
