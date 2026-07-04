import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { SUPPORT_ATTACHMENT_BUCKET } from "@/lib/support-inbox";

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

/** Content types the browser may render in-tab; everything else downloads. */
function isInlineViewable(contentType: string): boolean {
  return contentType.startsWith("image/") || contentType === "application/pdf";
}

/**
 * GET `/api/admin/support/:id/attachments/:attachmentId` — streams an
 * attachment's bytes from the private `support-attachments` bucket. The row
 * lookup runs on the admin's session client (RLS restricts it to admins);
 * the download uses the service-role client because the bucket has no
 * user-facing storage policies.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id, attachmentId } = await context.params;
  if (!id || !attachmentId) {
    return NextResponse.json({ error: "Missing attachment id" }, { status: 400 });
  }

  const { data: attachment, error } = await session.supabase
    .from("support_email_attachments")
    .select("id, filename, content_type, storage_path")
    .eq("id", attachmentId)
    .eq("support_email_id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load support attachment", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const { data: blob, error: downloadError } = await getSupabaseAdmin()
    .storage.from(SUPPORT_ATTACHMENT_BUCKET)
    .download(attachment.storage_path);

  if (downloadError || !blob) {
    console.error("Failed to download support attachment", downloadError);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }

  const contentType = attachment.content_type || "application/octet-stream";
  const filename = (attachment.filename ?? "attachment").replace(/"/g, "");
  const disposition = isInlineViewable(contentType) ? "inline" : "attachment";

  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600"
    }
  });
}
