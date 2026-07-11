import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./feature.module.css";

export type FeatureItem = { mark: ReactNode; title: string; body: string };

type Props = {
  eyebrow: string;
  title: string;
  lede: string;
  items: FeatureItem[];
};

/**
 * Public, logged-out explainer for a paid feature (Comparisons / Collections).
 * A hero + a grid of what-you-get cards. The closing conversion CTA is the
 * shared PricingTeaser, composed by the page itself.
 */
export default function FeatureExplainer({ eyebrow, title, lede, items }: Props) {
  return (
    <section className={styles.wrap}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>{lede}</p>
        <div className={styles.ctaRow}>
          <Link href="/signup" className={styles.primaryBtn}>
            Start free →
          </Link>
          <Link href="/explore" className={styles.secondaryBtn}>
            Browse the archive
          </Link>
        </div>
      </header>

      <div className={styles.grid}>
        {items.map((it) => (
          <article key={it.title} className={styles.item}>
            <span className={styles.itemMark} aria-hidden="true">
              {it.mark}
            </span>
            <h2 className={styles.itemTitle}>{it.title}</h2>
            <p className={styles.itemBody}>{it.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
