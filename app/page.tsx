import SiteHeader from "@/components/marketing/SiteHeader";
import NewsletterFanHero from "@/components/marketing/NewsletterFanHero";
import styles from "@/components/marketing/landing.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <NewsletterFanHero />
    </main>
  );
}
