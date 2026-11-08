import { NextResponse } from "next/server";
import { runCollectionMatchWorker } from "@/lib/collections-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Leaves headroom under maxDuration for the final chunk to finish. */
const WORKER_BUDGET_MS = 45_000;

/**
 * Smart-collection match builds, driven by pg_cron every 30 seconds while
 * any build is waiting (see the collection_match_cache migration). Same
 * shared secret as the ingest processor next door.
 */
function authorize(request: Request): boolean {
  const configured = process.env.INTERNAL_PROCESSOR_SECRET;
  if (!configured) return false;
  const header = request.headers.get("authorization");
  if (header && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() === configured;
  }
  return request.headers.get("x-pirol-processor-secret") === configured;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runCollectionMatchWorker({ budgetMs: WORKER_BUDGET_MS });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Collection match worker failed", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
