import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="auth-page">
      <h1>Account created</h1>
      <p>You’re signed in, but your account doesn’t have access to the Pirol workspace yet.</p>
      <p>
        Access is currently limited to approved accounts. Ask a project owner to grant you access
        (add your user id to the <code>admin_users</code> table in Supabase).
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit">Sign out</button>
      </form>
      <p>
        <Link href="/login">Back to login</Link>
      </p>
    </main>
  );
}
