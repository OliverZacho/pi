import { NextResponse } from "next/server";
import type { EmailOtpType, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { claimPendingInvites, resolveTeamGate } from "@/lib/teams-db";

const EMAIL_OTP_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email"
];

/**
 * Single funnel for every authenticated entry point:
 *  - Email links (magic link, signup, invite, email change, recovery)
 *    arrive with `token_hash` + `type` and are completed with
 *    `verifyOtp`. This works server-side and — unlike the PKCE `code`
 *    flow — needs no browser code-verifier, so links survive being
 *    opened on another device or in an email app's in-app browser.
 *  - Google OAuth arrives with `code` and is completed with
 *    `exchangeCodeForSession`.
 *
 * On success we claim any pending team invites (by email match) before
 * redirecting. The claim never blocks login — a failure just leaves the
 * invite pending.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();
  let user: User | null = null;

  if (tokenHash && rawType && (EMAIL_OTP_TYPES as string[]).includes(rawType)) {
    const { data, error } = await supabase.auth.verifyOtp({
      type: rawType as EmailOtpType,
      token_hash: tokenHash
    });
    if (!error) {
      user = data.user ?? data.session?.user ?? null;
    }
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      user = data.session?.user ?? null;
    }
  }

  if (user) {
    const admin = getSupabaseAdmin();
    let joinedTeam = false;
    if (user.email) {
      try {
        joinedTeam = await claimPendingInvites(admin, user.id, user.email);
      } catch (err) {
        console.error("Failed to claim team invites", err);
      }
    }

    // If their team access has ended (removed, or the owner's plan lapsed),
    // divert to the interstitial that explains it and offers to subscribe.
    // Never let this block login — fall through to the normal redirect.
    try {
      const gate = await resolveTeamGate(supabase, admin, user.id);
      if (gate) {
        return NextResponse.redirect(`${origin}/team/inactive`);
      }
    } catch (err) {
      console.error("Failed to resolve team gate", err);
    }

    // Just joined a team via invite: land on Explore with the one-shot
    // welcome modal (who added them, what the seat unlocks, offer the tour)
    // instead of whatever `next` the link carried.
    if (joinedTeam) {
      return NextResponse.redirect(`${origin}/explore?team_welcome=1`);
    }

    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}

/** Only allow same-origin relative redirects to avoid an open redirect. */
function safeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  // Default to the app, not the admin console — a fresh non-admin signup
  // would bounce off /admin to /access-denied.
  return "/explore";
}
