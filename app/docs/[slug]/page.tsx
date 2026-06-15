import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DOC_CATEGORIES,
  getAllArticleSlugs,
  getArticle
} from "@/lib/docs/content";
import {
  loadArticleInsights,
  type ArticleInsights
} from "@/lib/docs/article-insights";
import InsightFigure from "@/components/docs/InsightFigure";
import { SITE_URL } from "@/lib/site";
import styles from "@/components/docs/docs.module.css";

type PageProps = {
  params: Promise<{ slug: string }>;
};

// Articles that quote live archive numbers recompute at most every 30 minutes,
// so figures stay current without a database hit on every request.
export const revalidate = 1800;

export function generateStaticParams() {
  return getAllArticleSlugs().map((slug) => ({ slug }));
}

// Matches a `{{token}}` or a markdown `[label](/href)` link.
const INLINE_RE = /(\{\{[a-zA-Z0-9_]+\}\}|\[[^\]]+\]\([^)]+\))/g;

/**
 * Splits a paragraph into nodes, replacing each `{{token}}` with its bold value
 * and each `[label](/href)` with an inline link. Returns `null` when any token
 * is unresolved (data unavailable) so the caller drops the whole paragraph
 * rather than show a raw placeholder or a fabricated number.
 */
function interpolate(
  text: string,
  tokens: Record<string, string>
): ReactNode[] | null {
  if (!text.includes("{{") && !text.includes("](")) return [text];
  const parts = text.split(INLINE_RE);
  const nodes: ReactNode[] = [];
  for (const part of parts) {
    const token = part.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (token) {
      const value = tokens[token[1]];
      if (value === undefined) return null;
      nodes.push(<strong key={nodes.length}>{value}</strong>);
    } else if (link) {
      nodes.push(
        <Link key={nodes.length} href={link[2]} className={styles.inlineLink}>
          {link[1]}
        </Link>
      );
    } else if (part) {
      nodes.push(part);
    }
  }
  return nodes;
}

/** Plain-string variant for FAQ answers / JSON-LD; `null` if a token is missing. */
function resolveString(text: string, tokens: Record<string, string>): string | null {
  let ok = true;
  const out = text
    .replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
      const value = tokens[key];
      if (value === undefined) {
        ok = false;
        return "";
      }
      return value;
    })
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  return ok ? out : null;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const entry = getArticle(slug);
  if (!entry) return { title: "Not found — Pirol Learn" };
  return {
    title: `${entry.article.title} — Pirol Learn`,
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

  // Load live archive figures for benchmark articles; static articles get none.
  const insights: ArticleInsights = article.insight
    ? await loadArticleInsights(article.insight)
    : { tokens: {}, figures: {} };

  // Resolve FAQ answers; drop any whose live numbers aren't available.
  const faqs = (article.faqs ?? [])
    .map((faq) => {
      const answer = resolveString(faq.answer, insights.tokens);
      return answer ? { question: faq.question, answer } : null;
    })
    .filter((f): f is { question: string; answer: string } => f !== null);

  // Article + FAQPage structured data for search and answer engines (published
  // articles only). FAQPage is added only when at least one answer resolved.
  const url = `${SITE_URL}/docs/${slug}`;
  const jsonLd: Record<string, unknown>[] = [];
  if (!article.draft) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.description,
      mainEntityOfPage: url,
      isAccessibleForFree: true,
      author: { "@type": "Organization", name: "Pirol", url: SITE_URL },
      publisher: { "@type": "Organization", name: "Pirol", url: SITE_URL }
    });
    if (faqs.length > 0) {
      jsonLd.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer }
        }))
      });
    }
  }

  return (
    <>
      {jsonLd.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
      <main className={styles.content}>
        <p className={styles.breadcrumb}>
          <Link href="/docs">Learn</Link> &nbsp;/&nbsp; {category.title}
        </p>

        {article.draft ? (
          <span className={styles.draftBadge}>Draft</span>
        ) : null}

        <h1 className={styles.articleTitle}>{article.title}</h1>
        <div className={styles.metaRow}>
          <span>{article.readingTime}</span>
          {article.insight ? <span>· Updated continuously from live data</span> : null}
        </div>
        <p className={styles.lead}>{article.description}</p>

        {article.sections.map((section) => {
          const figure = section.figure
            ? insights.figures[section.figure.dataKey]
            : undefined;
          return (
            <section key={section.id} id={section.id} className={styles.section}>
              <h2>{section.heading}</h2>
              {section.body.map((paragraph, i) => {
                const nodes = interpolate(paragraph, insights.tokens);
                if (nodes === null) return null;
                return <p key={i}>{nodes}</p>;
              })}
              {figure ? <InsightFigure figure={figure} /> : null}
              {section.cta ? (
                <Link href={section.cta.href} className={styles.sectionCta}>
                  {section.cta.label}
                </Link>
              ) : null}
            </section>
          );
        })}

        {faqs.length > 0 ? (
          <section id="faq" className={styles.section}>
            <h2>Frequently asked questions</h2>
            <div className={styles.faqList}>
              {faqs.map((faq) => (
                <div key={faq.question} className={styles.faqItem}>
                  <h3 className={styles.faqQ}>{faq.question}</h3>
                  <p className={styles.faqA}>{faq.answer}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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
          {faqs.length > 0 ? (
            <li>
              <a href="#faq" className={styles.tocLink}>
                Frequently asked questions
              </a>
            </li>
          ) : null}
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
