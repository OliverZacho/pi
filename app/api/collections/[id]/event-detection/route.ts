import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import {
  CollectionEventDetectionError,
  detectCollectionEvent
} from "@/lib/collection-event";
import {
  isEligibleForEventDetection,
  isEventDetectionStale
} from "@/lib/collection-event-shared";
import {
  getCollectionForOwner,
  saveCollectionEventDetection
} from "@/lib/collections-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST `/api/collections/[id]/event-detection` — run (or return the
 * cached) LLM event detection for a collection the user owns.
 *
 * The client fires this when a collection looks event-shaped (see
 * `isEligibleForEventDetection`) and no fresh cache exists. Responses:
 *  - `{ detection }`        — cached or freshly computed payload
 *  - `{ detection: null }`  — collection isn't eligible; nothing cached
 *
 * A cached result is reused until the collection has grown enough to be
 * considered stale, except a cached *dismissal* (`confirmed: false`),
 * which is permanent — re-running it would resurrect a banner the user
 * already said no to.
 */
export async function POST(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
  }

  try {
    const detail = await getCollectionForOwner(session.supabase, session.user.id, id);
    if (!detail) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    const cached = detail.eventDetection;
    if (cached) {
      const dismissed = cached.confirmed === false;
      if (dismissed || !isEventDetectionStale(cached, detail.emails.length)) {
        return NextResponse.json({ detection: cached });
      }
    }

    if (!isEligibleForEventDetection(detail.emails)) {
      return NextResponse.json({ detection: cached ?? null });
    }

    const fresh = await detectCollectionEvent(
      detail.name,
      detail.emails.map((email) => ({
        id: email.id,
        subject: email.subject,
        preheader: email.preheader,
        receivedAt: email.receivedAt,
        category: email.category,
        companyName: email.companyName
      }))
    );

    // A re-run after staleness keeps the user's earlier confirmation —
    // they already opted in; new emails shouldn't bring the banner back.
    if (cached?.confirmed === true && fresh.status === "detected") {
      fresh.confirmed = true;
    }

    await saveCollectionEventDetection(session.supabase, session.user.id, id, fresh);
    return NextResponse.json({ detection: fresh });
  } catch (error) {
    if (error instanceof CollectionEventDetectionError) {
      console.error("Collection event detection failed", error);
      return NextResponse.json(
        { error: "Event detection is unavailable right now" },
        { status: 502 }
      );
    }
    console.error("Failed to run event detection", error);
    return NextResponse.json(
      { error: "Failed to run event detection" },
      { status: 500 }
    );
  }
}

/**
 * PATCH `/api/collections/[id]/event-detection` `{ confirmed: boolean }`
 * — record the user's answer to the detection banner. `true` unlocks
 * the insights section; `false` hides the feature for this collection.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const confirmed = (body as Record<string, unknown> | null)?.confirmed;
  if (typeof confirmed !== "boolean") {
    return NextResponse.json(
      { error: "'confirmed' must be a boolean" },
      { status: 400 }
    );
  }

  try {
    const detail = await getCollectionForOwner(session.supabase, session.user.id, id);
    if (!detail) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    if (!detail.eventDetection || detail.eventDetection.status !== "detected") {
      return NextResponse.json(
        { error: "No event detection to confirm" },
        { status: 409 }
      );
    }

    const updated = { ...detail.eventDetection, confirmed };
    await saveCollectionEventDetection(session.supabase, session.user.id, id, updated);
    return NextResponse.json({ detection: updated });
  } catch (error) {
    console.error("Failed to update event detection", error);
    return NextResponse.json(
      { error: "Failed to update event detection" },
      { status: 500 }
    );
  }
}
