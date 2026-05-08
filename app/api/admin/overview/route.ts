import { NextResponse } from "next/server";
import { getOverviewFromDb } from "@/lib/admin-db";
import type { EmailCategory } from "@/lib/admin-types";
import { requireAdminSession } from "@/lib/require-admin-api";

const VALID_CATEGORIES: EmailCategory[] = [
  "sale",
  "product_launch",
  "event",
  "content",
  "loyalty",
  "transactional",
  "seasonal",
  "partnership",
  "company_news",
  "other"
];

export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const categoryParam = url.searchParams.get("category");
  const requestedSize = Number.parseInt(url.searchParams.get("pageSize") ?? "", 10);
  const pageSize = Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : undefined;

  let category: EmailCategory | null = null;
  if (categoryParam) {
    if (!VALID_CATEGORIES.includes(categoryParam as EmailCategory)) {
      return NextResponse.json({ error: "Invalid category filter" }, { status: 400 });
    }
    category = categoryParam as EmailCategory;
  }

  try {
    const overview = await getOverviewFromDb(session.supabase, {
      cursor,
      category,
      pageSize
    });
    return NextResponse.json(overview);
  } catch (error) {
    console.error("Failed to load overview", error);
    return NextResponse.json({ error: "Failed to load admin overview" }, { status: 500 });
  }
}
