import { NextResponse } from "next/server";
import { addCompanyInboxInDb, CompanyNotFoundError } from "@/lib/admin-db";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Adds a secondary (non-primary) inbox to an existing company so the
 * brand can subscribe to more than one of the company's mailing lists
 * (e.g. men / women / press) without us having to duplicate the company
 * row. The generated address follows the same `<slug>-<yyyymmdd>` shape
 * as the primary inbox, with a numeric suffix appended when same-day
 * collisions occur.
 */
export async function POST(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing company id" }, { status: 400 });
  }

  try {
    const inbox = await addCompanyInboxInDb(session.supabase, id);
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
