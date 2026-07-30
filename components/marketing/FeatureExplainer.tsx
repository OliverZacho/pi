import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./feature.module.css";

export type FeatureItem = { mark: ReactNode; title: string; body: string };

type Props = {
  eyebrow: string;
  title: string;
  lede: string;
  items: FeatureItem[];
  /**
   * Optional large product miniature rendered between the hero and the
   * what-you-get grid (wrap it in `FeaturePoster` for the card chrome
   * and scroll-reveal).
   */
  poster?: ReactNode;
};

/**
 * Public, logged-out explainer for a feature. A hero + optional product
 * poster + a grid of what-you-get cards. The closing conversion CTA is
 * the shared PricingTeaser, composed by the page itself.
 *
 * CTA order mirrors the homepage's single goal: browse first, sign up
 * once the archive has done the selling.
 */
export default function FeatureExplainer({
  eyebrow,
  title,
  lede,
  items,
  poster
}: Props) {
  return (
    <section className={styles.wrap}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>{lede}</p>
        <div className={styles.ctaRow}>
          <Link href="/explore" className={styles.primaryBtn}>
            Browse the archive →
          </Link>
          <Link href="/signup" className={styles.secondaryBtn}>
            Start free
          </Link>
        </div>
      </header>

      {poster}

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
