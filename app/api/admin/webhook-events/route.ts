import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";

const ALLOWED_STATUSES = new Set([
  "received",
  "processing",
  "processed",
  "failed",
  "skipped"
]);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const cursor = url.searchParams.get("cursor");
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let query = session.supabase
    .from("webhook_events")
    .select(
      "id, source, svix_id, event_type, status, attempt_count, last_error, received_at, processed_at"
    )
    .order("received_at", { ascending: false })
    .limit(limit + 1);

  if (statusParam) {
    if (!ALLOWED_STATUSES.has(statusParam)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
    query = query.eq("status", statusParam);
  }

  if (cursor) {
    query = query.lt("received_at", cursor);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load webhook events", error);
    return NextResponse.json({ error: "Failed to load webhook events" }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].received_at : null;

  return NextResponse.json({ events: trimmed, nextCursor });
}
