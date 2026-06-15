import type { ReactNode } from "react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import styles from "./legal.module.css";

type Props = {
  eyebrow?: string;
  title: string;
  /** Human-readable date, e.g. "15 June 2026". */
  lastUpdated: string;
  intro?: ReactNode;
  children: ReactNode;
};

/**
 * Shared shell for the public policy pages (/privacy, /terms, /takedown):
 * marketing header + a single readable document column + the site footer.
 * Pass the policy body as children using the prose classes via <Prose />.
 */
export default function LegalPage({ eyebrow = "Legal", title, lastUpdated, intro, children }: Props) {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <article className={styles.wrap}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.updated}>Last updated {lastUpdated}</p>
          {intro ? <div className={styles.intro}>{intro}</div> : null}
        </header>
        <div className={styles.prose}>{children}</div>
      </article>
      <SiteFooter />
    </main>
  );
}

/** A still-to-be-filled placeholder token, visually flagged in the rendered page. */
export function Fill({ children }: { children: ReactNode }) {
  return <span className={styles.fill}>{children}</span>;
}
