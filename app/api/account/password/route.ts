import { createClient as createBareClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { userHasPassword } from "@/lib/profile-db";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const MIN_PASSWORD_LENGTH = 8;
// bcrypt truncates beyond 72 bytes, so longer passwords are misleading.
const MAX_PASSWORD_LENGTH = 72;

/**
 * POST `/api/account/password` `{ currentPassword?, newPassword }` —
 * sets or changes the caller's password.
 *
 * Magic-link/OAuth signups have no password, so whether `currentPassword`
 * is required comes from the `user_has_password()` DB check — never from
 * the client. Supabase has no "verify password" primitive; the standard
 * pattern is a throwaway sign-in with the current password. The throwaway
 * client never persists a session, so the request's cookies stay intact.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const newPassword = typeof parsed.newPassword === "string" ? parsed.newPassword : "";
  const currentPassword =
    typeof parsed.currentPassword === "string" ? parsed.currentPassword : "";

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  try {
    const hasPassword = await userHasPassword(session.supabase);

    if (hasPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required" },
          { status: 400 }
        );
      }
      if (!session.user.email) {
        return NextResponse.json(
          { error: "Account has no email to verify against" },
          { status: 400 }
        );
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !anonKey) {
        throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or anon/publishable key");
      }

      const verifier = createBareClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { error: verifyError } = await verifier.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword
      });

      if (verifyError) {
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 403 }
        );
      }
    }

    // Admin update sidesteps the project's optional "secure password
    // change" reauthentication requirement on client-side updateUser.
    const admin = getSupabaseAdmin();
    const { error: updateError } = await admin.auth.admin.updateUserById(
      session.user.id,
      { password: newPassword }
    );

    if (updateError) {
      console.error("Failed to update password", updateError);
      return NextResponse.json(
        { error: "Failed to update password" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update password", error);
    return NextResponse.json(
      { error: "Failed to update password" },
      { status: 500 }
    );
  }
}
