import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="auth-page">
      <h1>Access denied</h1>
      <p>Your account is signed in but is not listed as a Pirol admin.</p>
      <p>
        Ask a project owner to add your user id to the <code>admin_users</code> table in Supabase.
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
