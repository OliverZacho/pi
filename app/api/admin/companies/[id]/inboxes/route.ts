import { NextResponse } from "next/server";
import {
  addCompanyInboxInDb,
  CompanyNotFoundError,
  type InboxSegmentInput
} from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Pulls the optional segment fields out of a raw JSON body. A POST with no
 * body (the common "+ Add inbox" click) yields `undefined`, leaving the new
 * inbox un-segmented; an operator can tag it afterwards via PATCH.
 */
function readSegmentBody(body: unknown): InboxSegmentInput | undefined {
  if (!body || typeof body !== "object") return undefined;
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
  return Object.keys(segment).length > 0 ? segment : undefined;
}

/**
 * Adds a secondary (non-primary) inbox to an existing company so the
 * brand can subscribe to more than one of the company's mailing lists
 * (e.g. men / women / press) without us having to duplicate the company
 * row. The generated address follows the same `<slug>-<yyyymmdd>` shape
 * as the primary inbox, with a numeric suffix appended when same-day
 * collisions occur.
 */
export async function POST(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing company id" }, { status: 400 });
  }

  const segment = readSegmentBody(await request.json().catch(() => null));

  try {
    const inbox = await addCompanyInboxInDb(session.supabase, id, segment);
    return NextResponse.json({ inbox }, { status: 201 });
  } catch (error) {
    if (error instanceof CompanyNotFoundError) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    console.error("Failed to add company inbox", error);
    return NextResponse.json(
      { error: "Failed to add additional inbox" },
      { status: 500 }
    );
  }
}
