import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="auth-page">
      <h1>Admin access required</h1>
      <p>
        You’re signed in, but this area is reserved for Pirol administrators.
      </p>
      <p>
        <Link href="/explore">Go to the app</Link>
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
