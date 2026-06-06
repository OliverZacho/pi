import Link from "next/link";
import { DOC_CATEGORIES } from "@/lib/docs/content";
import styles from "@/components/docs/docs.module.css";

export const metadata = {
  title: "Documentation — Pirol",
  description:
    "Everything you need to choose an email platform, plan your sending strategy, stay out of spam, and measure what works."
};

export default function DocsHome() {
  return (
    <main className={styles.content}>
      <div className={styles.landing}>
        <p className={styles.landingEyebrow}>Get Started</p>
        <h1 className={styles.landingTitle}>Pirol Documentation</h1>
        <p className={styles.landingLead}>
          Practical guides on email marketing — from choosing an ESP and planning
          your sending cadence to deliverability and the metrics that actually
          predict revenue. Start with the fundamentals or jump to whatever you
          are working on.
        </p>

        {DOC_CATEGORIES.map((category) => (
          <section key={category.id} className={styles.categoryBlock}>
            <h2 className={styles.categoryTitle}>{category.title}</h2>
            <p className={styles.categoryBlurb}>{category.blurb}</p>
            <div className={styles.cardGrid}>
              {category.articles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/docs/${article.slug}`}
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
