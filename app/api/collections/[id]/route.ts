import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { getViewer } from "@/lib/access";
import { hasActiveTeamPlan } from "@/lib/teams-db";
import {
  CollectionRulesValidationError,
  deleteCollection,
  getCollectionForOwner,
  parseCollectionRules,
  renameCollection,
  resolveAppliedAt,
  setCollectionIcon,
  setCollectionRules,
  setCollectionShared
} from "@/lib/collections-db";
import { isCollectionIcon } from "@/lib/collection-icons";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const MAX_NAME_LENGTH = 120;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET `/api/collections/[id]` — owner-side detail: the collection meta
 * plus every email currently in it. Powers `/collections/[id]`.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
  }

  try {
    const detail = await getCollectionForOwner(
      session.supabase,
      session.user.id,
      id
    );
    if (!detail) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ collection: detail });
  } catch (error) {
    console.error("Failed to load collection", error);
    return NextResponse.json(
      { error: "Failed to load collection" },
      { status: 500 }
    );
  }
}

/**
 * PATCH `/api/collections/[id]` `{ name?, rules? }` — owner-only
 * mutation. Accepts a partial body: either field may be supplied
 * independently. `rules: null` explicitly clears the saved query and
 * flips the collection back into manual mode.
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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const obj = body as Record<string, unknown>;
  const hasName = Object.prototype.hasOwnProperty.call(obj, "name");
  const hasRules = Object.prototype.hasOwnProperty.call(obj, "rules");
  const hasIcon = Object.prototype.hasOwnProperty.call(obj, "icon");
  const hasShared = Object.prototype.hasOwnProperty.call(obj, "sharedWithTeam");

  if (!hasName && !hasRules && !hasIcon && !hasShared) {
    return NextResponse.json(
      {
        error:
          "At least one of 'name', 'rules', 'icon' or 'sharedWithTeam' is required"
      },
      { status: 400 }
    );
  }

  if (hasShared && typeof obj.sharedWithTeam !== "boolean") {
    return NextResponse.json(
      { error: "'sharedWithTeam' must be a boolean" },
      { status: 400 }
    );
  }

  // Sharing a collection with your team is a Team-plan feature. The UI
  // already locks the button for non-team owners (funneling them to
  // /pricing), but guard the API too so a crafted request can't flip a
  // collection to shared without entitlement. Un-sharing (`false`) is
  // always allowed, so a lapsed team can still turn it back off.
  if (hasShared && obj.sharedWithTeam === true) {
    const viewer = await getViewer();
    let entitled = viewer?.isAdmin ?? false;
    if (!entitled) {
      try {
        entitled = await hasActiveTeamPlan(session.supabase, session.user.id);
      } catch (err) {
        console.error("Failed to check team plan for collection share", err);
      }
    }
    if (!entitled) {
      return NextResponse.json(
        { error: "Sharing collections with your team requires the Team plan." },
        { status: 403 }
      );
    }
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

  // `icon: null` clears the icon; any non-null value must be in the
  // curated allow-list.
  if (hasIcon && obj.icon !== null && !isCollectionIcon(obj.icon)) {
    return NextResponse.json(
      { error: "Unsupported collection icon" },
      { status: 400 }
    );
  }

  try {
    if (hasRules) {
      let rules;
      try {
        rules = parseCollectionRules(obj.rules);
      } catch (err) {
        if (err instanceof CollectionRulesValidationError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }

      // Stamp `appliedAt` server-side so the client can't backdate the
      // cutoff (which would silently include emails the user shouldn't
      // see in a "future only" rule, for example). If the scope is
      // unchanged we preserve the existing anchor across edits so
      // adding an extra brand doesn't reset the cutoff.
      if (rules) {
        const existingDetail = await getCollectionForOwner(
          session.supabase,
          session.user.id,
          id
        );
        if (!existingDetail) {
          return NextResponse.json(
            { error: "Collection not found" },
            { status: 404 }
          );
        }
        rules = {
          ...rules,
          appliedAt: resolveAppliedAt(existingDetail.rules, rules.scope)
        };
      }

      const ok = await setCollectionRules(
        session.supabase,
        session.user.id,
        id,
        rules
      );
      if (!ok) {
        return NextResponse.json(
          { error: "Collection not found" },
          { status: 404 }
        );
      }
    }

    if (hasName) {
      const updated = await renameCollection(
        session.supabase,
        session.user.id,
        id,
        obj.name as string
      );
      if (!updated) {
        return NextResponse.json(
          { error: "Collection not found" },
          { status: 404 }
        );
      }
    }

    if (hasIcon) {
      const updated = await setCollectionIcon(
        session.supabase,
        session.user.id,
        id,
        isCollectionIcon(obj.icon) ? obj.icon : null
      );
      if (!updated) {
        return NextResponse.json(
          { error: "Collection not found" },
          { status: 404 }
        );
      }
    }

    if (hasShared) {
      const updated = await setCollectionShared(
        session.supabase,
        session.user.id,
        id,
        obj.sharedWithTeam as boolean
      );
      if (!updated) {
        return NextResponse.json(
          { error: "Collection not found" },
          { status: 404 }
        );
      }
    }

    // Refresh the detail view so the client always receives the
    // canonical state (including the freshly-evaluated email list when
    // rules just changed). Cheaper than building the response out of
    // the individual update return values, and a lot less code.
    const detail = await getCollectionForOwner(
      session.supabase,
      session.user.id,
      id
    );
    if (!detail) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ collection: detail });
  } catch (error) {
    console.error("Failed to update collection", error);
    return NextResponse.json(
      { error: "Failed to update collection" },
      { status: 500 }
    );
  }
}

/**
 * DELETE `/api/collections/[id]` — owner-only delete. The DB
 * cascades the `collection_emails` rows for free.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
  }

  try {
    const removed = await deleteCollection(
      session.supabase,
      session.user.id,
      id
    );
    if (!removed) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete collection", error);
    return NextResponse.json(
      { error: "Failed to delete collection" },
      { status: 500 }
    );
  }
}
