"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CodeInput from "./CodeInput";
import { perMonthLabel } from "@/lib/pricing";
import styles from "./checkout-auth.module.css";

/** Match the Supabase Auth "Email OTP length" setting. */
const CODE_LENGTH = 6;

export type CheckoutPlan = {
  id: "solo" | "team";
  name: string;
  monthly: number;
  annual: number;
  features: string[];
};

type Mode = "signup" | "login";
type Step = "details" | "business" | "verify" | "linkSent";

/**
 * The paid-plan checkout gate for logged-out visitors, shown after they pick a
 * tier. Split screen: the left panel walks them through creating an account (or
 * logging in), the right panel keeps the plan they're buying in view the whole
 * time so it's clear the account is a means to that purchase.
 *
 * Signup collects name + password (+ optional business details), then confirms
 * the email with a 6-digit code (`verifyOtp type:"signup"`), which also
 * establishes the session. Login signs in with a password, or falls back to a
 * magic link that resumes checkout on return. Either way we then resume the
 * Stripe checkout for the chosen plan — unless the returning user already has
 * an active subscription, in which case we unlock in place instead of charging.
 */
export default function CheckoutAuthFlow({
  plan,
  billing,
  onBack,
  onClose
}: {
  plan: CheckoutPlan;
  billing: "monthly" | "annual";
  /** Return to the plan cards. */
  onBack: () => void;
  /** Dismiss the whole modal (only when opened as a dismissible upgrade). */
  onClose?: () => void;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signup");
  const [step, setStep] = useState<Step>("details");
  const [passwordless, setPasswordless] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isBusiness, setIsBusiness] = useState(false);
  const [company, setCompany] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [country, setCountry] = useState("");
  const [code, setCode] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perMonth = perMonthLabel(plan.monthly, plan.annual, billing === "annual");

  /** Buyer/business fields to persist on signup and pass to checkout. */
  function buyerData() {
    return {
      full_name: fullName.trim(),
      is_business: isBusiness,
      ...(isBusiness
        ? {
            company: company.trim(),
            vat_number: vatNumber.trim(),
            country: country.trim()
          }
        : {})
    };
  }

  /** Create the account (password or passwordless), which sends the code email. */
  async function createAccount() {
    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=/explore`;
    if (passwordless) {
      // Existing emails would get a magic *link* instead of a code (Supabase
      // picks the template by user existence), so catch them up front.
      const { data: exists, error: checkError } = await supabase.rpc("email_has_account", {
        check_email: email.trim()
      });
      if (checkError) throw new Error(checkError.message);
      if (exists) {
        throw new Error("That email already has an account. Log in instead.");
      }
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true, emailRedirectTo, data: buyerData() }
      });
      if (otpError) throw new Error(otpError.message);
    } else {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // password_signup tells the on_auth_user_change trigger to stamp
        // user_profiles.password_set_at (OTP signups get a random hash, so
        // the hash itself can't distinguish real passwords).
        options: { emailRedirectTo, data: { ...buyerData(), password_signup: true } }
      });
      if (signUpError) {
        if (/already registered|already exists/i.test(signUpError.message)) {
          throw new Error(
            "That email already has an account. Log in instead."
          );
        }
        throw new Error(signUpError.message);
      }
    }
  }

  /**
   * Google OAuth — a full redirect, so carry the chosen plan through
   * /auth/callback (via `next`) so we land back in checkout for it once the
   * session is established. See `GET /api/checkout/continue`.
   */
  async function continueWithGoogle() {
    if (pending) return;
    setError(null);
    setPending(true);
    const next = `/api/checkout/continue?plan=${plan.id}&billing=${billing}`;
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      }
    });
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
    // On success the browser redirects to Google.
  }

  async function onSubmitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    // Business buyers give their company details before we create the account.
    if (isBusiness) {
      setStep("business");
      return;
    }
    setPending(true);
    try {
      await createAccount();
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setPending(false);
    }
  }

  async function onSubmitBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await createAccount();
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setPending(false);
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || code.length < CODE_LENGTH) return;
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: "signup"
      });
      if (verifyError) throw new Error(verifyError.message);
      await finishCheckout();
    } catch {
      setError("That code didn't work. Check it and try again, or resend.");
      setPending(false);
    }
  }

  async function onSubmitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });
      if (signInError) throw new Error("Wrong email or password.");
      await finishCheckout();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setPending(false);
    }
  }

  /**
   * Existing user forgot their password — email a magic login link that
   * carries the chosen plan through /auth/callback (same mechanism as the
   * Google path), so clicking it logs them in and resumes this checkout.
   * No account is created for an unknown email in this login context.
   */
  async function sendLoginLink() {
    if (pending) return;
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const next = `/api/checkout/continue?plan=${plan.id}&billing=${billing}`;
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
        }
      });
      if (otpError) {
        // Supabase rejects unknown emails with "Signups not allowed for otp".
        if (/signups not allowed|otp_disabled/i.test(otpError.message)) {
          throw new Error("No account found for that email. Create one instead.");
        }
        throw new Error(otpError.message);
      }
      setStep("linkSent");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not email a login link"
      );
    } finally {
      setPending(false);
    }
  }

  /** Session is set — start checkout, or unlock if they already subscribe. */
  async function finishCheckout() {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: plan.id,
        billing,
        name: fullName.trim() || undefined,
        isBusiness,
        company: company.trim() || undefined,
        vatNumber: vatNumber.trim() || undefined,
        country: country.trim() || undefined
      })
    });
    const data: { url?: string; alreadyActive?: boolean; error?: string } =
      await res.json();
    if (data.alreadyActive) {
      // Returning subscriber — they're already entitled, so just unlock.
      if (onClose) onClose();
      router.refresh();
      return;
    }
    if (!res.ok || !data.url) {
      throw new Error(data.error ?? "Could not start checkout");
    }
    window.location.assign(data.url);
  }

  async function resendCode() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await createAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code");
    } finally {
      setPending(false);
    }
  }

  const oauthBlock = (
    <>
      <button
        type="button"
        className={styles.oauthBtn}
        onClick={continueWithGoogle}
        disabled={pending}
      >
        <GoogleMark />
        Continue with Google
      </button>
      <div className={styles.divider}>
        <span>or</span>
      </div>
    </>
  );

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Get ${plan.name}`}
      onClick={
        onClose
          ? (e) => {
              if (e.target === e.currentTarget && !pending) onClose();
            }
          : undefined
      }
    >
      <div className={styles.modal}>
        {onClose ? (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
          >
            ×
          </button>
        ) : null}

        {/* LEFT — the account / login flow */}
        <div className={styles.left}>
          {step === "linkSent" ? (
            <>
              <button
                type="button"
                className={styles.back}
                onClick={() => setStep("details")}
              >
                ← Back
              </button>
              <h2 className={styles.title}>Check your email</h2>
              <p className={styles.lead}>
                We sent a login link to <strong>{email.trim()}</strong>. Open
                it on this device to log in and continue to payment.
              </p>
              <div className={styles.altRow}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={sendLoginLink}
                  disabled={pending}
                >
                  Resend link
                </button>
              </div>
            </>
          ) : step === "verify" ? (
            <>
              <button
                type="button"
                className={styles.back}
                onClick={() =>
                  setStep(
                    mode === "signup" && isBusiness ? "business" : "details"
                  )
                }
              >
                ← Back
              </button>
              <h2 className={styles.title}>Enter your code</h2>
              <p className={styles.lead}>
                We sent a {CODE_LENGTH}-digit code to{" "}
                <strong>{email.trim()}</strong>. Enter it to confirm your
                email and continue to payment.
              </p>
              <form className={styles.form} onSubmit={onSubmitCode}>
                <CodeInput
                  length={CODE_LENGTH}
                  value={code}
                  onChange={setCode}
                  disabled={pending}
                />
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={pending || code.length < CODE_LENGTH}
                >
                  {pending ? "Verifying…" : "Confirm & continue"}
                </button>
              </form>
              <div className={styles.altRow}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={resendCode}
                  disabled={pending}
                >
                  Resend code
                </button>
              </div>
            </>
          ) : mode === "signup" ? (
            <>
              {step === "details" ? (
                <>
                  <button type="button" className={styles.back} onClick={onBack}>
                    ← Back to plans
                  </button>
                  <h2 className={styles.title}>Create your account</h2>
                  <p className={styles.lead}>
                    Create an account to complete your purchase.
                  </p>
                  {oauthBlock}
                  <form className={styles.form} onSubmit={onSubmitDetails}>
                    <label className={styles.field}>
                      <span className={styles.label}>Full name</span>
                      <input
                        className={styles.input}
                        type="text"
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        autoFocus
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Email</span>
                      <input
                        className={styles.input}
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </label>
                    {!passwordless ? (
                      <label className={styles.field}>
                        <span className={styles.label}>Password</span>
                        <input
                          className={styles.input}
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </label>
                    ) : null}
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={isBusiness}
                        onChange={(e) => setIsBusiness(e.target.checked)}
                      />
                      <span>I&apos;m purchasing as a business</span>
                    </label>
                    <button
                      type="submit"
                      className={styles.primaryBtn}
                      disabled={pending}
                    >
                      {pending
                        ? "One moment…"
                        : isBusiness
                          ? "Continue"
                          : "Create account"}
                    </button>
                  </form>
                  <div className={styles.altRow}>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => setPasswordless((v) => !v)}
                    >
                      {passwordless
                        ? "Use a password instead"
                        : "Email me a one-time code instead"}
                    </button>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => {
                        setMode("login");
                        setError(null);
                      }}
                    >
                      Already have an account? Log in
                    </button>
                  </div>
                </>
              ) : null}

              {step === "business" ? (
                <>
                  <button
                    type="button"
                    className={styles.back}
                    onClick={() => setStep("details")}
                  >
                    ← Back
                  </button>
                  <h2 className={styles.title}>Business details</h2>
                  <p className={styles.lead}>
                    We&apos;ll add these to your invoices.
                  </p>
                  <form className={styles.form} onSubmit={onSubmitBusiness}>
                    <label className={styles.field}>
                      <span className={styles.label}>Company name</span>
                      <input
                        className={styles.input}
                        type="text"
                        autoComplete="organization"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        required
                        autoFocus
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>VAT / CVR number</span>
                      <input
                        className={styles.input}
                        type="text"
                        value={vatNumber}
                        onChange={(e) => setVatNumber(e.target.value)}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Country</span>
                      <input
                        className={styles.input}
                        type="text"
                        autoComplete="country-name"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      className={styles.primaryBtn}
                      disabled={pending}
                    >
                      {pending ? "One moment…" : "Create account"}
                    </button>
                  </form>
                </>
              ) : null}
            </>
          ) : (
            // LOGIN mode
            <>
              <button type="button" className={styles.back} onClick={onBack}>
                ← Back to plans
              </button>
              <h2 className={styles.title}>Log in to continue</h2>
              <p className={styles.lead}>
                Sign in to complete your {plan.name} purchase.
              </p>
              {oauthBlock}
              <form className={styles.form} onSubmit={onSubmitLogin}>
                <label className={styles.field}>
                  <span className={styles.label}>Email</span>
                  <input
                    className={styles.input}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Password</span>
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={pending}
                >
                  {pending ? "Signing in…" : "Log in & continue"}
                </button>
              </form>
              <div className={styles.altRow}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={sendLoginLink}
                  disabled={pending}
                >
                  Forgot your password? Email me a login link
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                  }}
                >
                  New here? Create an account
                </button>
              </div>
            </>
          )}

          {error ? <p className={styles.error}>{error}</p> : null}
        </div>

        {/* RIGHT — the persistent order summary */}
        <aside className={styles.right}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryEyebrow}>You&apos;re buying</span>
            <h3 className={styles.summaryPlan}>Pirol {plan.name}</h3>
            <div className={styles.summaryPrice}>
              <span className={styles.summaryAmount}>€{perMonth}</span>
              <span className={styles.summaryUnit}>/mo</span>
            </div>
            <p className={styles.summaryBilling}>
              {billing === "annual"
                ? `€${plan.annual} billed yearly (2 months free)`
                : "billed monthly"}
            </p>
            <ul className={styles.summaryFeatures}>
              {plan.features.map((f) => (
                <li key={f} className={styles.summaryFeature}>
                  <svg
                    className={styles.summaryCheck}
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      d="m5 10 3.5 3.5L15 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <p className={styles.summaryFinePrint}>
              Secure payment through Stripe. Cancel anytime.
            </p>
          </div>
          <p className={styles.summaryRefund}>
            7 day refund, no questions asked.
          </p>
        </aside>
      </div>
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
