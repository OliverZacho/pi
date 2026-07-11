"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CodeInput from "@/components/onboarding/CodeInput";
import styles from "../login/login.module.css";

/** Match the Supabase Auth "Email OTP length" setting. */
const CODE_LENGTH = 6;

type Step = "details" | "code" | "password";

/**
 * Email signup: name + email → 6-digit confirmation code (which establishes
 * the session) → create a password. Google skips all of that via OAuth.
 * Existing emails are caught up front with the `email_has_account` RPC,
 * because Supabase would otherwise send them a magic *link* while this UI
 * sits waiting for a code.
 */
export default function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Land on the app by default; /explore onboards fresh accounts (tour +
  // plan choice) on arrival.
  const nextPath = searchParams.get("next") ?? "/explore";
  const safeNext = nextPath.startsWith("/") ? nextPath : "/explore";

  const [step, setStep] = useState<Step>("details");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [existingAccount, setExistingAccount] = useState(false);
  const [pending, setPending] = useState(false);

  const loginHref = `/login?next=${encodeURIComponent(safeNext)}`;

  // Google comes back through /auth/callback, which exchanges the PKCE
  // `code` for a session. Preserve `next` so the user lands where intended.
  function callbackUrl() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
  }

  async function onGoogle() {
    setError("");
    setPending(true);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() }
    });
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
    // On success the browser is redirected to Google, so no further work here.
  }

  async function sendCode() {
    const supabase = createClient();
    const { data: exists, error: checkError } = await supabase.rpc("email_has_account", {
      check_email: email.trim()
    });
    if (checkError) throw new Error(checkError.message);
    if (exists) {
      setExistingAccount(true);
      return false;
    }
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        // The name lands in user_profiles via the on_auth_user_change trigger.
        data: { full_name: fullName.trim() }
      }
    });
    if (otpError) throw new Error(otpError.message);
    return true;
  }

  async function onSubmitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setExistingAccount(false);
    setPending(true);
    try {
      if (await sendCode()) {
        setCode("");
        setStep("code");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setPending(false);
    }
  }

  async function onResend() {
    if (pending) return;
    setError("");
    setPending(true);
    try {
      await sendCode();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code");
    } finally {
      setPending(false);
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || code.length < CODE_LENGTH) return;
    setError("");
    setPending(true);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: "email"
    });
    setPending(false);
    if (verifyError) {
      setError("That code didn't work. Check it and try again, or resend.");
      return;
    }
    setStep("password");
  }

  async function onSubmitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password })
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not set the password");
      router.push(safeNext);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the password");
      setPending(false);
    }
  }

  if (step === "code") {
    return (
      <div className={styles.form}>
        <h1 className={styles.title}>Confirm your email</h1>
        <p className={styles.subtitle}>
          We sent a {CODE_LENGTH}-digit code to <strong>{email.trim()}</strong>. Enter it below to
          continue.
        </p>
        <form className={styles.fieldGroup} onSubmit={onSubmitCode}>
          <CodeInput length={CODE_LENGTH} value={code} onChange={setCode} disabled={pending} />
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={pending || code.length < CODE_LENGTH}
          >
            {pending ? "Verifying…" : "Confirm email"}
          </button>
        </form>
        {error ? <p className={styles.error}>{error}</p> : null}
        <p className={styles.footer}>
          Didn’t get it? Check spam, or{" "}
          <button type="button" className={styles.linkButton} onClick={onResend} disabled={pending}>
            resend the code
          </button>
          .
        </p>
        <p className={styles.footer}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setError("");
              setStep("details");
            }}
          >
            Use a different email
          </button>
        </p>
      </div>
    );
  }

  if (step === "password") {
    return (
      <div className={styles.form}>
        <h1 className={styles.title}>Create a password</h1>
        <p className={styles.subtitle}>
          Your email is confirmed. Pick a password to finish setting up your account.
        </p>
        <form className={styles.fieldGroup} onSubmit={onSubmitPassword}>
          <input
            className={styles.input}
            type="password"
            placeholder="Password (min. 8 characters)"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          <button type="submit" className={styles.primaryBtn} disabled={pending}>
            {pending ? "One moment…" : "Create account"}
          </button>
        </form>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <h1 className={styles.title}>Create your account</h1>
      <p className={styles.subtitle}>Start exploring thousands of brand emails</p>

      <form className={styles.fieldGroup} onSubmit={onSubmitDetails}>
        <input
          className={styles.input}
          type="text"
          placeholder="Full name"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
        <input
          className={styles.input}
          type="email"
          placeholder="Email address"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" className={styles.primaryBtn} disabled={pending}>
          {pending ? "Sending code…" : "Continue with email"}
        </button>
      </form>

      <div className={styles.divider}>OR</div>

      <button type="button" className={styles.oauthBtn} onClick={onGoogle} disabled={pending}>
        <GoogleMark />
        {pending ? "One moment…" : "Continue with Google"}
      </button>

      {existingAccount ? (
        <p className={styles.error}>
          That email already has an account.{" "}
          <Link className={styles.link} href={loginHref}>
            Log in instead
          </Link>
          .
        </p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <p className={styles.footer}>
        Already have an account?{" "}
        <Link className={styles.link} href={loginHref}>
          Log in
        </Link>
      </p>
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
