import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { claimPendingInvites } from "@/lib/teams-db";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Every emailed link (magic link, team invite, email change) and
      // OAuth login funnels through here, so this is the one spot to
      // claim pending team invites by email match. Never block login on
      // it — a failed claim just means the invite stays pending.
      const user = data.session?.user;
      if (user?.email) {
        try {
          await claimPendingInvites(getSupabaseAdmin(), user.id, user.email);
        } catch (err) {
          console.error("Failed to claim team invites", err);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
