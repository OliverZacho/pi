import { NextResponse } from "next/server";
import { FREE_SAVE_LIMIT } from "@/lib/access";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  countSavedEmails,
  freeSaveDecision,
  isEmailSaved,
  saveEmail,
  unsaveEmail
} from "@/lib/saved-emails-db";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ emailId: string }> };

/**
 * Saving is open to any signed-in user, but entitlement decides how:
 *  - Paid / admin (has_archive_access): unrestricted, via their own
 *    session client (RLS scopes the row).
 *  - Free: the service-role client performs the write, and the route
 *    enforces the only free-tier rule — a FREE_SAVE_LIMIT cap. (Free
 *    users can already view the whole archive's link-stripped previews,
 *    so there's no content/curated restriction to apply.) Their session
 *    tokens have no RLS grant on saved_emails, so the cap can't be
 *    bypassed via direct PostgREST.
 */
async function resolveSaveContext() {
  const session = await requireSession();
  if ("response" in session) {
    return { error: session.response } as const;
  }
  const { data: hasAccess } = await session.supabase.rpc("has_archive_access");
  return {
    userId: session.user.id,
    hasAccess: Boolean(hasAccess),
    client: hasAccess ? session.supabase : getSupabaseAdmin()
  } as const;
}

/**
 * `PUT /api/explore/saved/[emailId]` — idempotent save (the Explore
 * card's Save button uses this).
 */
export async function PUT(_request: Request, context: RouteContext) {
  const ctx = await resolveSaveContext();
  if ("error" in ctx) {
    return ctx.error;
  }

  const { emailId } = await context.params;
  if (!UUID_PATTERN.test(emailId)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  try {
    if (!ctx.hasAccess) {
      const [alreadySaved, count] = await Promise.all([
        isEmailSaved(ctx.client, ctx.userId, emailId),
        countSavedEmails(ctx.client, ctx.userId)
      ]);
      const decision = freeSaveDecision({
        alreadySaved,
        count,
        limit: FREE_SAVE_LIMIT
      });
      if (!decision.ok) {
        return NextResponse.json(
          { error: decision.error, code: decision.code },
          { status: decision.status }
        );
      }
    }

    await saveEmail(ctx.client, ctx.userId, emailId);
    return NextResponse.json({ ok: true, saved: true });
  } catch (error) {
    console.error("Failed to save email", error);
    return NextResponse.json(
      { error: "Failed to save email" },
      { status: 500 }
    );
  }
}

/**
 * `DELETE /api/explore/saved/[emailId]` — remove the bookmark. Always
 * allowed for any signed-in user (frees a slot under the cap).
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const ctx = await resolveSaveContext();
  if ("error" in ctx) {
    return ctx.error;
  }

  const { emailId } = await context.params;
  if (!UUID_PATTERN.test(emailId)) {
    return NextResponse.json({ error: "Invalid email id" }, { status: 400 });
  }

  try {
    await unsaveEmail(ctx.client, ctx.userId, emailId);
    return NextResponse.json({ ok: true, saved: false });
  } catch (error) {
    console.error("Failed to unsave email", error);
    return NextResponse.json(
      { error: "Failed to unsave email" },
      { status: 500 }
    );
  }
}
