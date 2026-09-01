import { NextResponse } from "next/server";
import { FREE_FOLLOW_LIMIT } from "@/lib/access";
import { requireSessionWithEntitlement } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { countFollows, followBrandsBatch } from "@/lib/follows-db";
import { normalizeHost } from "@/lib/logo-dev";
import {
  MIN_ONBOARDING_FOLLOWS,
  parseOnboardingCompletion
} from "@/lib/onboarding";
import { stampOnboardingCompleted } from "@/lib/plan-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/onboarding/complete` — finishes (or skips) the new-signup
 * onboarding modal in one shot: batch-follows the tracked picks, records
 * untracked picks as brand_requests rows for the admin queue, and stamps
 * `onboarding_completed_at` with the questionnaire answers.
 *
 * Skips are permanent and keep whatever partial answers the user gave.
 * All writes run on the service-role client (free session tokens hold no
 * RLS grants on these tables); the free follow cap is re-enforced here so
 * the batch path can never out-privilege the single-follow route — though
 * with 20 max picks against a cap of 25 it should never fire for a fresh
 * account.
 */
export async function POST(request: Request) {
  const session = await requireSessionWithEntitlement();
  if ("response" in session) {
    return session.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const parsed = parseOnboardingCompletion(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { payload } = parsed;
  const admin = getSupabaseAdmin();
  const userId = session.user.id;
  const answers = {
    role: payload.role,
    categories: payload.categories,
    ownBrandDomain: payload.ownBrandDomain
  };

  try {
    if (payload.skipped) {
      await stampOnboardingCompleted(admin, userId, answers);
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Verify the tracked picks against live companies, and resolve any
    // "untracked" request whose domain we actually track into a follow —
    // Logo.dev and our catalogue can disagree on how a brand was found.
    const { data: companies, error: companiesError } = await admin
      .from("companies")
      .select("id, domain")
      .is("deleted_at", null);
    if (companiesError) throw companiesError;

    const liveIds = new Set<string>();
    const byHost = new Map<string, string>();
    for (const row of companies ?? []) {
      liveIds.add(row.id);
      const host = row.domain ? normalizeHost(row.domain) : null;
      if (host && !byHost.has(host)) byHost.set(host, row.id);
    }

    const followIds = new Set(
      payload.follows.filter((id) => liveIds.has(id))
    );
    const requests: { name: string; domain: string }[] = [];
    for (const pick of payload.requests) {
      const trackedId = byHost.get(pick.domain);
      if (trackedId) {
        followIds.add(trackedId);
      } else {
        requests.push(pick);
      }
    }

    const totalPicks = followIds.size + requests.length;
    if (totalPicks < MIN_ONBOARDING_FOLLOWS) {
      return NextResponse.json(
        { error: `Pick at least ${MIN_ONBOARDING_FOLLOWS} brands` },
        { status: 400 }
      );
    }

    if (!session.hasAccess) {
      const count = await countFollows(admin, userId);
      if (count + followIds.size > FREE_FOLLOW_LIMIT) {
        return NextResponse.json(
          {
            error: `Free accounts can follow up to ${FREE_FOLLOW_LIMIT} brands. Upgrade to follow more.`,
            code: "FOLLOW_LIMIT_REACHED"
          },
          { status: 409 }
        );
      }
    }

    await followBrandsBatch(admin, userId, Array.from(followIds));

    if (requests.length > 0) {
      // The partial unique index (requested_by, lower(domain)) where pending
      // is an expression index PostgREST's on_conflict can't target, so
      // dedupe by hand: skip domains already pending for this user, and let
      // the index catch the remaining race (23505 = another submit of the
      // same picks won — fine, the queue row exists).
      const { data: pending, error: pendingError } = await admin
        .from("brand_requests")
        .select("domain")
        .eq("requested_by", userId)
        .eq("status", "pending");
      if (pendingError) throw pendingError;
      const pendingDomains = new Set(
        (pending ?? [])
          .map((row) => (row.domain ? row.domain.toLowerCase() : null))
          .filter(Boolean)
      );
      const fresh = requests.filter(
        (pick) => !pendingDomains.has(pick.domain.toLowerCase())
      );
      if (fresh.length > 0) {
        const { error: requestsError } = await admin.from("brand_requests").insert(
          fresh.map((pick) => ({
            company_name: pick.name,
            website: pick.domain,
            domain: pick.domain,
            source: "onboarding",
            requested_by: userId
          }))
        );
        if (requestsError && requestsError.code !== "23505") {
          throw requestsError;
        }
      }
    }

    await stampOnboardingCompleted(admin, userId, answers);

    return NextResponse.json({
      ok: true,
      followed: followIds.size,
      requested: requests.length
    });
  } catch (error) {
    console.error("Failed to complete onboarding", error);
    return NextResponse.json(
      { error: "Failed to complete onboarding" },
      { status: 500 }
    );
  }
}
