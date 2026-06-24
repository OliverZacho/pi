import Link from "next/link";
import type { Metadata } from "next";
import SearchingLogo from "@/components/SearchingLogo";
import styles from "@/components/notFound.module.css";

export const metadata: Metadata = {
  title: "Page not found — Pirol",
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <SearchingLogo className={styles.logo} />
      <p className={styles.code}>Error 404</p>
      <h1 className={styles.message}>
        We looked high and low — even with both eyes — but there are no emails
        to show you down this route.
      </h1>
      <Link href="/explore" className={styles.button}>
        Back to the app
      </Link>
    </main>
  );
}
