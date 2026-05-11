import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import {
  SuggestCompaniesError,
  type SuggestionCandidate,
  normalizeDomain,
  suggestCompanies,
  verifyDomains
} from "@/lib/suggest-companies";

type SuggestBody = {
  market?: string;
  count?: number;
};

const MAX_COUNT = 30;
const DEFAULT_COUNT = 10;
const MAX_LLM_ROUNDS = 2;

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

    const baselineExclude = new Set<string>();
    for (const row of companiesRes.data ?? []) {
      const normalized = normalizeDomain(row.domain);
      if (normalized) {
        baselineExclude.add(normalized);
      }
    }
    for (const row of skipsRes.data ?? []) {
      const rowMarket = (row.market ?? "").trim().toLowerCase();
      if (rowMarket && rowMarket !== market) {
        continue;
      }
      const normalized = normalizeDomain(row.domain);
      if (normalized) {
        baselineExclude.add(normalized);
      }
    }

    const accepted = new Map<string, SuggestionCandidate>();
    const droppedDomains: string[] = [];
    let lastModel: string | null = null;
    let totalProposed = 0;

    for (let round = 0; round < MAX_LLM_ROUNDS; round += 1) {
      const remaining = count - accepted.size;
      if (remaining <= 0) {
        break;
      }

      const excludeForRound = new Set(baselineExclude);
      for (const domain of accepted.keys()) {
        excludeForRound.add(domain);
      }
      for (const domain of droppedDomains) {
        excludeForRound.add(domain);
      }

      const roundRequest = Math.min(MAX_COUNT, Math.max(remaining, remaining + 5));

      const llm = await suggestCompanies({
        market,
        count: roundRequest,
        excludeDomains: Array.from(excludeForRound)
      });

      lastModel = llm.model;
      totalProposed += llm.candidates.length;

      if (llm.candidates.length === 0) {
        break;
      }

      const verification = await verifyDomains(
        llm.candidates.map((candidate) => candidate.domain)
      );

      const verdictByDomain = new Map<string, boolean>();
      for (const v of verification.verifications) {
        verdictByDomain.set(v.domain, v.ok);
      }

      let acceptedThisRound = 0;
      for (const candidate of llm.candidates) {
        if (accepted.has(candidate.domain)) {
          continue;
        }
        const ok = verdictByDomain.get(candidate.domain) ?? false;
        if (!ok) {
          if (!droppedDomains.includes(candidate.domain)) {
            droppedDomains.push(candidate.domain);
          }
          continue;
        }
        accepted.set(candidate.domain, candidate);
        acceptedThisRound += 1;
        if (accepted.size >= count) {
          break;
        }
      }

      if (acceptedThisRound === 0) {
        break;
      }
    }

    const candidates = Array.from(accepted.values()).slice(0, count);

    return NextResponse.json({
      market,
      model: lastModel,
      candidates,
      stats: {
        proposed: totalProposed,
        verified: candidates.length,
        dropped: droppedDomains.length
      },
      droppedDomains
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
