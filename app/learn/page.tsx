import Link from "next/link";
import { DOC_CATEGORIES } from "@/lib/docs/content";
import styles from "@/components/docs/docs.module.css";

export const metadata = {
  title: "Learn — Pirol",
  description:
    "Everything you need to choose an email platform, plan your sending strategy, stay out of spam, and measure what works."
};

export default function DocsHome() {
  return (
    <main className={styles.content}>
      <div className={styles.landing}>
        <p className={styles.landingEyebrow}>Learn</p>
        <h1 className={styles.landingTitle}>Email marketing, by the numbers</h1>
        <p className={styles.landingLead}>
          Practical guides on email marketing — backed by live benchmarks from the
          brands Pirol tracks. See which platforms brands actually use, when they
          send, how often, and how deep they discount, then turn it into your own
          edge. Start with a benchmark or jump to whatever you are working on.
        </p>

        {DOC_CATEGORIES.map((category) => (
          <section key={category.id} className={styles.categoryBlock}>
            <h2 className={styles.categoryTitle}>{category.title}</h2>
            <p className={styles.categoryBlurb}>{category.blurb}</p>
            <div className={styles.cardGrid}>
              {category.articles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/learn/${article.slug}`}
                  className={styles.card}
                >
                  <span className={styles.cardTitle}>{article.title}</span>
                  <p className={styles.cardDesc}>{article.description}</p>
                  <span className={styles.cardMeta}>{article.readingTime}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
