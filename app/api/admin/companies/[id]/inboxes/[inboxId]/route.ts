import { NextResponse } from "next/server";
import {
  CompanyNotFoundError,
  deleteCompanyInboxInDb,
  updateCompanyInboxInDb,
  type InboxSegmentInput
} from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string; inboxId: string }>;
};

/**
 * Pulls the segment patch out of a raw JSON body. Only keys actually present
 * are forwarded, so the caller can update just the label (say) without
 * clobbering the category/country.
 */
function readSegmentPatch(body: unknown): InboxSegmentInput {
  if (!body || typeof body !== "object") return {};
  const obj = body as Record<string, unknown>;
  const segment: InboxSegmentInput = {};
  if ("segmentLabel" in obj) {
    segment.segmentLabel =
      typeof obj.segmentLabel === "string" ? obj.segmentLabel : null;
  }
  if ("segmentCategory" in obj) {
    segment.segmentCategory =
      typeof obj.segmentCategory === "string" ? obj.segmentCategory : null;
  }
  if ("segmentCountry" in obj) {
    segment.segmentCountry =
      typeof obj.segmentCountry === "string" ? obj.segmentCountry : null;
  }
  return segment;
}

/**
 * Re-tags an inbox's subscription segment (product line / country / label).
 * The DB trigger fans the change out onto the inbox's existing emails so the
 * brand page and Explore stay consistent without a manual backfill.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id, inboxId } = await context.params;
  if (!id || !inboxId) {
    return NextResponse.json(
      { error: "Missing company or inbox id" },
      { status: 400 }
    );
  }

  const segment = readSegmentPatch(await request.json().catch(() => null));
  if (Object.keys(segment).length === 0) {
    return NextResponse.json(
      { error: "No segment fields supplied" },
      { status: 400 }
    );
  }

  try {
    const inbox = await updateCompanyInboxInDb(
      session.supabase,
      id,
      inboxId,
      segment
    );
    return NextResponse.json({ inbox });
  } catch (error) {
    if (error instanceof CompanyNotFoundError) {
      return NextResponse.json({ error: "Inbox not found" }, { status: 404 });
    }
    console.error("Failed to update company inbox", error);
    return NextResponse.json(
      { error: "Failed to update inbox segment" },
      { status: 500 }
    );
  }
}

/**
 * Deletes a company inbox (e.g. the old catch-all address). Captured emails
 * are kept on the brand; if the primary was removed, another inbox is
 * promoted and its id returned so the client can refresh its row.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id, inboxId } = await context.params;
  if (!id || !inboxId) {
    return NextResponse.json(
      { error: "Missing company or inbox id" },
      { status: 400 }
    );
  }

  try {
    const result = await deleteCompanyInboxInDb(session.supabase, id, inboxId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CompanyNotFoundError) {
      return NextResponse.json({ error: "Inbox not found" }, { status: 404 });
    }
    console.error("Failed to delete company inbox", error);
    return NextResponse.json(
      { error: "Failed to delete inbox" },
      { status: 500 }
    );
  }
}
