import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { removeBrandFromSet } from "@/lib/competitor-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = {
  params: Promise<{ id: string; companyId: string }>;
};

/**
 * DELETE `/api/competitor-sets/[id]/brands/[companyId]` — owner-only
 * removal. Idempotent: returns `ok` whether or not the row existed,
 * unless the set itself doesn't belong to the caller.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id, companyId } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(companyId)) {
    return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
  }

  try {
    const result = await removeBrandFromSet(
      session.supabase,
      session.user.id,
      id,
      companyId
    );
    if (result === "missing") {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to remove brand from competitor set", error);
    return NextResponse.json(
      { error: "Failed to remove brand" },
      { status: 500 }
    );
  }
}
