import Link from "next/link";
import { phaseLabel, type BfHeadline } from "@/lib/black-friday";
import styles from "./black-friday-teaser.module.css";

/** Homepage strip pointing at the live Black Friday tracker. */
export default function BlackFridayTeaser({ headline: h }: { headline: BfHeadline }) {
  return (
    <section className={styles.strip} aria-label="Black Friday tracker">
      <p className={styles.label}>
        <span className={styles.dot} aria-hidden /> Black Friday 2026 · {phaseLabel(h.through)}
      </p>
      <ul className={styles.stats}>
        <li>
          <strong>{h.brands_live}</strong> brands live
        </li>
        <li>
          <strong>{h.bf_emails.toLocaleString("en-US")}</strong> emails
        </li>
        {h.median_discount != null && (
          <li>
            <strong>{Math.round(h.median_discount)}%</strong> median discount
          </li>
        )}
      </ul>
      <Link href="/black-friday" className={styles.link}>
        See the Black Friday tracker
      </Link>
    </section>
  );
}
