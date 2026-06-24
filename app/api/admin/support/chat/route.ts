import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

const STATUS_FILTERS = new Set(["active", "archived", "all"]);

/**
 * GET `/api/admin/support/chat` — lists in-app support chat threads, most
 * recently active first, with the admin's unread badge count. Message bodies
 * live on the detail route. `?status=active|archived|all` (default: active).
 */
export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const statusParam = new URL(request.url).searchParams.get("status") ?? "";
  const status = STATUS_FILTERS.has(statusParam) ? statusParam : "active";

  let query = session.supabase
    .from("support_chat_threads")
    .select(
      "id, user_id, user_email, status, last_message_at, last_message_sender, user_unread_count, admin_unread_count, created_at"
    )
    .order("last_message_at", { ascending: false })
    .limit(300);

  if (status === "active") {
    query = query.eq("status", "open");
  } else if (status === "archived") {
    query = query.eq("status", "archived");
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load support chat threads", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const { count: unreadCount } = await session.supabase
    .from("support_chat_threads")
    .select("id", { count: "exact", head: true })
    .gt("admin_unread_count", 0);

  return NextResponse.json({ threads: data ?? [], unreadCount: unreadCount ?? 0 });
}
