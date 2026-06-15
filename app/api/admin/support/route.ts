import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

const STATUS_FILTERS = new Set(["unread", "read", "archived", "all"]);

/**
 * GET `/api/admin/support` — lists support inbox messages, newest first.
 * Optional `?status=unread|read|archived|all` (default: everything except
 * archived). Bodies are omitted here; the detail route returns them.
 */
export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") ?? "";
  const status = STATUS_FILTERS.has(statusParam) ? statusParam : "active";

  let query = session.supabase
    .from("support_emails")
    .select(
      "id, from_address, from_name, to_address, subject, plain_text, received_at, status, replied_at"
    )
    .order("received_at", { ascending: false })
    .limit(300);

  if (status === "active") {
    query = query.in("status", ["unread", "read"]);
  } else if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load support emails", error);
    return NextResponse.json(
      { error: "Failed to load support emails" },
      { status: 500 }
    );
  }

  const { count: unreadCount } = await session.supabase
    .from("support_emails")
    .select("id", { count: "exact", head: true })
    .eq("status", "unread");

  return NextResponse.json({ emails: data ?? [], unreadCount: unreadCount ?? 0 });
}
