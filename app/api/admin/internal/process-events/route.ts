import { NextResponse } from "next/server";
import { processNextBatch } from "@/lib/ingest-processor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_BATCH_LIMIT = 5;
const MAX_BATCH_LIMIT = 50;

function getInternalSecret(): string {
  const secret = process.env.INTERNAL_PROCESSOR_SECRET;
  if (!secret) {
    throw new Error("Missing INTERNAL_PROCESSOR_SECRET");
  }
  return secret;
}

function authorize(request: Request): boolean {
  let configured: string;
  try {
    configured = getInternalSecret();
  } catch {
    return false;
  }

  const header = request.headers.get("authorization");
  if (header && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() === configured;
  }

  const explicit = request.headers.get("x-pirol-processor-secret");
  return explicit === configured;
}

async function runProcessor(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_BATCH_LIMIT)
    : DEFAULT_BATCH_LIMIT;

  try {
    const result = await processNextBatch(limit);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Internal processor failed", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return runProcessor(request);
}

export async function GET(request: Request) {
  return runProcessor(request);
}
