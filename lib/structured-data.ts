import { SITE_URL } from "@/lib/site";

/**
 * Stable schema.org @id anchors for the site's core entities. Other pages can
 * reference these (e.g. as author/publisher) so search and answer engines
 * resolve every mention back to one Pirol entity.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/**
 * Sitewide JSON-LD graph: the Pirol Organization and the WebSite it publishes.
 * Rendered once on the home page so search engines and answer engines (Google
 * AI Overviews, ChatGPT, Perplexity, Claude) can resolve "Pirol" to a stable
 * entity and cite/link it.
 *
 * No `logo` is set yet — schema recommends a real image URL and the site has
 * no served logo asset. Add one (e.g. /icon.png) and set `logo` here when it
 * exists; an absent logo is better than a 404.
 */
export function siteStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: "Pirol",
        url: SITE_URL,
        description:
          "Pirol tracks how real brands run their email marketing — a curated catalogue of newsletters, benchmarks on what top senders do, and guides to choosing and running an email platform."
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: "Pirol",
        url: SITE_URL,
        publisher: { "@id": ORGANIZATION_ID },
        inLanguage: "en"
      }
    ]
  };
}
