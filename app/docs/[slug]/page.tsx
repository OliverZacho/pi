import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DOC_CATEGORIES,
  getAllArticleSlugs,
  getArticle
} from "@/lib/docs/content";
import styles from "@/components/docs/docs.module.css";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getAllArticleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const entry = getArticle(slug);
  if (!entry) return { title: "Not found — Pirol Docs" };
  return {
    title: `${entry.article.title} — Pirol Docs`,
    description: entry.article.description
  };
}

// Flat, ordered list across every category — powers prev / next navigation.
const ORDERED = DOC_CATEGORIES.flatMap((category) =>
  category.articles.map((article) => ({ slug: article.slug, title: article.title }))
);

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const entry = getArticle(slug);
  if (!entry) notFound();

  const { article, category } = entry;
  const index = ORDERED.findIndex((a) => a.slug === slug);
  const prev = index > 0 ? ORDERED[index - 1] : null;
  const next = index < ORDERED.length - 1 ? ORDERED[index + 1] : null;

  return (
    <>
      <main className={styles.content}>
        <p className={styles.breadcrumb}>
          <Link href="/docs">Docs</Link> &nbsp;/&nbsp; {category.title}
        </p>

        {article.draft ? (
          <span className={styles.draftBadge}>Draft</span>
        ) : null}

        <h1 className={styles.articleTitle}>{article.title}</h1>
        <div className={styles.metaRow}>
          <span>{article.readingTime}</span>
        </div>
        <p className={styles.lead}>{article.description}</p>

        {article.sections.map((section) => (
          <section key={section.id} id={section.id} className={styles.section}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </section>
        ))}

        <nav className={styles.articleNav} aria-label="More articles">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className={styles.articleNavLink}>
              <span className={styles.articleNavLabel}>← Previous</span>
              <span className={styles.articleNavTitle}>{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className={`${styles.articleNavLink} ${styles.next}`}
            >
              <span className={styles.articleNavLabel}>Next →</span>
              <span className={styles.articleNavTitle}>{next.title}</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </main>

      <aside className={styles.toc} aria-label="On this page">
        <p className={styles.tocHeading}>On this page</p>
        <ul className={styles.tocList}>
          {article.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className={styles.tocLink}>
                {section.heading}
              </a>
            </li>
          ))}
        </ul>
        <div className={styles.tocAside}>
          <Link href="/help" className={styles.tocAsideLink}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M8 10h8M8 14h5M21 12a9 9 0 1 1-3.5-7.1L21 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Question? Contact us
          </Link>
        </div>
      </aside>
    </>
  );
}
