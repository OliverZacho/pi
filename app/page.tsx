import SiteHeader from "@/components/marketing/SiteHeader";
import NewsletterFanHero from "@/components/marketing/NewsletterFanHero";
import HomeStory from "@/components/marketing/HomeStory";
import BlackFridayTeaser from "@/components/marketing/BlackFridayTeaser";
import HomeBrands from "@/components/marketing/HomeBrands";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import { siteStructuredData } from "@/lib/structured-data";
import { getArchiveStats } from "@/lib/marketing-stats";
import { loadHomepageCategories } from "@/lib/brand-link-index";
import { loadBlackFridayHeadline } from "@/lib/black-friday";
import styles from "@/components/marketing/landing.module.css";
import { pageMetadata } from "@/lib/page-metadata";

// Refresh the live archive numbers hourly.
export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "Pirol — See how the best brands do email",
  description:
    "Pirol tracks how real brands run their email marketing. Browse a curated catalogue of newsletters, study what top senders do, and learn how to choose and run your email platform.",
  path: "/"
});

export default async function Home() {
  // Read once per hourly regeneration, together so neither waits on the other.
  const [stats, brandCategories, blackFriday] = await Promise.all([
    getArchiveStats(),
    loadHomepageCategories(),
    loadBlackFridayHeadline()
  ]);

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteStructuredData()) }}
      />
      <SiteHeader />
      <NewsletterFanHero />
      {blackFriday && <BlackFridayTeaser headline={blackFriday} />}
      <HomeStory stats={stats} />
      <HomeBrands categories={brandCategories} />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}
