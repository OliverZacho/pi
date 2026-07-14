import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * DELETE `/api/admin/probes/[id]` — stop tracking a probe. Only the probe
 * row goes away; any mail it captured stays in captured_emails.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing probe id" }, { status: 400 });
  }

  const { error } = await session.supabase
    .from("signup_probes")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to delete signup probe", error);
    return NextResponse.json({ error: "Failed to delete probe" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
