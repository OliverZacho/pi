import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { normalizeDomain } from "@/lib/suggest-companies";

type SkipBody = {
  domain?: string;
  market?: string | null;
  reason?: string | null;
};

const MAX_REASON_LENGTH = 280;

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  let body: SkipBody;
  try {
    body = (await request.json()) as SkipBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const domain = normalizeDomain(body.domain);
  if (!domain) {
    return NextResponse.json({ error: "Valid domain is required" }, { status: 400 });
  }

  const marketRaw = typeof body.market === "string" ? body.market.trim().toLowerCase() : "";
  const market = marketRaw.length > 0 ? marketRaw : null;

  const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
  const reason = reasonRaw.length > 0 ? reasonRaw.slice(0, MAX_REASON_LENGTH) : null;

  try {
    const { error } = await session.supabase
      .from("suggestion_skips")
      .insert({ domain, market, reason });

    if (error) {
      const isUniqueViolation =
        typeof error.code === "string" && error.code === "23505";
      if (!isUniqueViolation) {
        throw error;
      }
    }

    return NextResponse.json({ ok: true, domain, market }, { status: 201 });
  } catch (error) {
    console.error("Failed to record suggestion skip", error);
    return NextResponse.json(
      { error: "Failed to record suggestion skip" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);
  const marketParam = url.searchParams.get("market");
  const market = marketParam ? marketParam.trim().toLowerCase() : "";

  let query = session.supabase
    .from("suggestion_skips")
    .select("domain, market, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (market) {
    query = query.eq("market", market);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load suggestion skips", error);
    return NextResponse.json(
      { error: "Failed to load suggestion skips" },
      { status: 500 }
    );
  }

  return NextResponse.json({ skips: data ?? [] });
}
