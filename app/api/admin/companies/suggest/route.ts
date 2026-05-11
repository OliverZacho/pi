import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import {
  SuggestCompaniesError,
  normalizeDomain,
  suggestCompanies
} from "@/lib/suggest-companies";

type SuggestBody = {
  market?: string;
  count?: number;
};

const MAX_COUNT = 30;
const DEFAULT_COUNT = 10;

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  let body: SuggestBody;
  try {
    body = (await request.json()) as SuggestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const market = typeof body.market === "string" ? body.market.trim().toLowerCase() : "";
  if (!market) {
    return NextResponse.json({ error: "market is required" }, { status: 400 });
  }

  const rawCount =
    typeof body.count === "number" && Number.isFinite(body.count) ? body.count : DEFAULT_COUNT;
  const count = Math.max(1, Math.min(MAX_COUNT, Math.floor(rawCount)));

  try {
    const [companiesRes, skipsRes] = await Promise.all([
      session.supabase
        .from("companies")
        .select("domain")
        .is("deleted_at", null),
      session.supabase.from("suggestion_skips").select("domain, market")
    ]);

    if (companiesRes.error) {
      throw companiesRes.error;
    }
    if (skipsRes.error) {
      throw skipsRes.error;
    }

    const excludeSet = new Set<string>();
    for (const row of companiesRes.data ?? []) {
      const normalized = normalizeDomain(row.domain);
      if (normalized) {
        excludeSet.add(normalized);
      }
    }
    for (const row of skipsRes.data ?? []) {
      const rowMarket = (row.market ?? "").trim().toLowerCase();
      if (rowMarket && rowMarket !== market) {
        continue;
      }
      const normalized = normalizeDomain(row.domain);
      if (normalized) {
        excludeSet.add(normalized);
      }
    }

    const result = await suggestCompanies({
      market,
      count,
      excludeDomains: Array.from(excludeSet)
    });

    return NextResponse.json({
      market,
      model: result.model,
      candidates: result.candidates
    });
  } catch (error) {
    if (error instanceof SuggestCompaniesError) {
      const status = error.code === "missing_api_key" ? 503 : 502;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      );
    }
    console.error("Failed to suggest companies", error);
    return NextResponse.json(
      { error: "Failed to suggest companies" },
      { status: 500 }
    );
  }
}
