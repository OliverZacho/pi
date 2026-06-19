import { SITE_URL } from "@/lib/site";
import { DOC_CATEGORIES } from "@/lib/docs/content";

/**
 * Serves /llms.txt — a curated, LLM-friendly index of the public site.
 * Deliberately scoped to marketing + finished guides; the email archive
 * is not advertised here.
 */
export function GET() {
  const guideLines = DOC_CATEGORIES.flatMap((category) =>
    category.articles
      .filter((article) => !article.draft)
      .map(
        (article) =>
          `- [${article.title}](${SITE_URL}/learn/${article.slug}): ${article.description}`
      )
  );

  const body = `# Pirol

> Pirol tracks how real brands run their email marketing. Browse a curated catalogue of newsletters, study what top senders do, and learn the fundamentals of choosing and running an email platform.

## Start here

- [Pirol home](${SITE_URL}/): What Pirol is and who it's for.
- [Pricing](${SITE_URL}/pricing): Plans and what each tier includes.
- [Learn](${SITE_URL}/learn): Plain-language guides to email marketing.
- [Tutorials](${SITE_URL}/tutorials): Short video walkthroughs of every Pirol feature.

## Features

- [Collections](${SITE_URL}/features/collections): Group and organise saved newsletters.
- [Comparisons](${SITE_URL}/features/comparisons): See how brands' email programs stack up side by side.

## Guides
${guideLines.join("\n")}

## Notes

- The email archive itself (individual brands and saved newsletters) lives behind the app and is not intended for automated crawling.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600"
    }
  });
}
