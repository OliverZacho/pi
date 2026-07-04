import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { getViewer } from "@/lib/access";
import { hasActiveTeamPlan } from "@/lib/teams-db";
import {
  deleteCompetitorSet,
  getCompetitorSetForOwner,
  renameCompetitorSet,
  setCompetitorSetShared
} from "@/lib/competitor-db";
import { competitorSetWriteFailure } from "@/lib/competitor-set-api";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const MAX_NAME_LENGTH = 120;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET `/api/competitor-sets/[id]` — owner-side detail: set meta + every
 * brand currently in it (with signed logo URLs).
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }

  try {
    const detail = await getCompetitorSetForOwner(
      session.supabase,
      session.user.id,
      id
    );
    if (!detail) {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ set: detail });
  } catch (error) {
    console.error("Failed to load competitor set", error);
    return NextResponse.json(
      { error: "Failed to load competitor set" },
      { status: 500 }
    );
  }
}

/**
 * PATCH `/api/competitor-sets/[id]` `{ name?, sharedWithTeam? }` —
 * owner-only. Either field may be supplied; `sharedWithTeam` toggles team
 * read access.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const obj = body as Record<string, unknown>;
  const hasName = Object.prototype.hasOwnProperty.call(obj, "name");
  const hasShared = Object.prototype.hasOwnProperty.call(obj, "sharedWithTeam");

  if (!hasName && !hasShared) {
    return NextResponse.json(
      { error: "At least one of 'name' or 'sharedWithTeam' is required" },
      { status: 400 }
    );
  }

  if (hasName) {
    if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (obj.name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }
  }

  if (hasShared && typeof obj.sharedWithTeam !== "boolean") {
    return NextResponse.json(
      { error: "'sharedWithTeam' must be a boolean" },
      { status: 400 }
    );
  }

  // Sharing a comparison with your team is a Team-plan feature. The UI already
  // locks the button for non-team owners (funneling them into the upgrade),
  // but guard the API too so a crafted request can't flip a set to shared
  // without entitlement. Un-sharing (`false`) is always allowed, so a lapsed
  // team can still turn it back off.
  if (hasShared && obj.sharedWithTeam === true) {
    const viewer = await getViewer();
    let entitled = viewer?.isAdmin ?? false;
    if (!entitled) {
      try {
        entitled = await hasActiveTeamPlan(session.supabase, session.user.id);
      } catch (err) {
        console.error("Failed to check team plan for comparison share", err);
      }
    }
    if (!entitled) {
      return NextResponse.json(
        { error: "Sharing comparisons with your team requires the Team plan." },
        { status: 403 }
      );
    }
  }

  try {
    if (hasName) {
      const renamed = await renameCompetitorSet(
        session.supabase,
        session.user.id,
        id,
        obj.name as string
      );
      if (!renamed) {
        return competitorSetWriteFailure(session.supabase, id);
      }
    }

    if (hasShared) {
      const updated = await setCompetitorSetShared(
        session.supabase,
        session.user.id,
        id,
        obj.sharedWithTeam as boolean
      );
      if (!updated) {
        return competitorSetWriteFailure(session.supabase, id);
      }
    }

    const detail = await getCompetitorSetForOwner(
      session.supabase,
      session.user.id,
      id
    );
    if (!detail) {
      return NextResponse.json({ error: "Set not found" }, { status: 404 });
    }
    return NextResponse.json({ set: detail });
  } catch (error) {
    console.error("Failed to update competitor set", error);
    return NextResponse.json(
      { error: "Failed to update competitor set" },
      { status: 500 }
    );
  }
}

/**
 * DELETE `/api/competitor-sets/[id]` — owner-only delete. The DB
 * cascades `competitor_set_members` for free.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }

  try {
    const removed = await deleteCompetitorSet(
      session.supabase,
      session.user.id,
      id
    );
    if (!removed) {
      return competitorSetWriteFailure(session.supabase, id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete competitor set", error);
    return NextResponse.json(
      { error: "Failed to delete competitor set" },
      { status: 500 }
    );
  }
}
