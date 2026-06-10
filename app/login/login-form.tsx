"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./login.module.css";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Land on the app by default — non-admin users bounced off /admin would
  // otherwise hit /access-denied right after signing up. Admins reach
  // /admin via nav.
  const nextPath = searchParams.get("next") ?? "/explore";
  const safeNext = nextPath.startsWith("/") ? nextPath : "/explore";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [pending, setPending] = useState<null | "google" | "magic" | "password">(null);

  // Both magic links and the Google OAuth round-trip come back through the
  // existing /auth/callback route, which exchanges the PKCE `code` for a
  // session. Preserve the caller's `next` so they land where they intended.
  function callbackUrl() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
  }

  async function onGoogle() {
    setError("");
    setPending("google");
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() }
    });
    if (oauthError) {
      setError(oauthError.message);
      setPending(null);
    }
    // On success the browser is redirected to Google, so no further work here.
  }

  async function onMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending("magic");
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Passwordless sign-up doubles as sign-in: create the account on the
        // first link if it doesn't exist yet.
        shouldCreateUser: true,
        emailRedirectTo: callbackUrl()
      }
    });
    setPending(null);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setMagicSent(true);
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending("password");
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    setPending(null);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push(safeNext);
    router.refresh();
  }

  if (magicSent) {
    return (
      <div className={styles.form}>
        <svg className={styles.sentIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.subtitle}>
          We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device to
          finish signing in.
        </p>
        <p className={styles.footer}>
          Didn’t get it? Check spam, or{" "}
          <button type="button" className={styles.linkButton} onClick={() => setMagicSent(false)}>
            try a different email
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <h1 className={styles.title}>Welcome to Pirol</h1>
      <p className={styles.subtitle}>Log in or sign up to continue</p>

      {searchParams.get("error") === "auth" ? (
        <p className={styles.error}>Authentication failed. Try again or request a new link.</p>
      ) : null}

      <form className={styles.fieldGroup} onSubmit={onMagicLink}>
        <input
          className={styles.input}
          type="email"
          placeholder="Email address"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" className={styles.primaryBtn} disabled={pending !== null}>
          {pending === "magic" ? "Sending…" : "Continue with email"}
        </button>
      </form>

      <div className={styles.divider}>OR</div>

      <button
        type="button"
        className={styles.oauthBtn}
        onClick={onGoogle}
        disabled={pending !== null}
      >
        <GoogleMark />
        {pending === "google" ? "Redirecting…" : "Continue with Google"}
      </button>

      {showPassword ? (
        <form className={styles.fieldGroup} onSubmit={onPassword} style={{ marginTop: "0.75rem" }}>
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" className={styles.primaryBtn} disabled={pending !== null}>
            {pending === "password" ? "Signing in…" : "Sign in with password"}
          </button>
        </form>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {!showPassword ? (
        <p className={styles.footer}>
          <button type="button" className={styles.linkButton} onClick={() => setShowPassword(true)}>
            Sign in with a password instead
          </button>
        </p>
      ) : null}
      <p className={styles.footer}>
        <Link className={styles.link} href="/">
          Back to home
        </Link>
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
