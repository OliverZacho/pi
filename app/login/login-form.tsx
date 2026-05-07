"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push(nextPath.startsWith("/") ? nextPath : "/admin");
    router.refresh();
  }

  return (
    <>
      <h1>Pirol Admin</h1>
      <p>Sign in with the email and password for your Supabase Auth user.</p>
      {searchParams.get("error") === "auth" ? (
        <p className="error">Authentication failed. Try again or use the link from your email.</p>
      ) : null}
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">
        First time: create the user in the Supabase dashboard (Authentication), then run{" "}
        <code>{`insert into admin_users (user_id) values ('your-user-uuid');`}</code>
      </p>
      <p>
        <Link href="/">Home</Link>
      </p>
    </>
  );
}
