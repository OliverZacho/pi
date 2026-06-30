import { NextResponse } from "next/server";
import { isDigestCadence } from "@/lib/notification-prefs";
import { runDigest } from "@/lib/digest/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Digest runs fan out one Resend send per eligible user; give the
// function room beyond the default so a full run isn't cut off.
export const maxDuration = 300;

/**
 * `GET|POST /api/cron/digest?cadence=daily|weekly|monthly`
 *
 * The editorial digest entry point, invoked by Vercel Cron (see
 * vercel.json). Vercel attaches `Authorization: Bearer <CRON_SECRET>` to
 * scheduled requests; we reject anything without the matching secret so
 * the route can't be triggered by the public.
 */

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cadence = new URL(request.url).searchParams.get("cadence") ?? "";
  if (!isDigestCadence(cadence)) {
    return NextResponse.json(
      { error: "cadence must be daily, weekly or monthly" },
      { status: 400 }
    );
  }

  try {
    const summary = await runDigest(cadence);
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("Digest run failed", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
