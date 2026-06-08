import Header from "@/components/marketing/Header";
import NewsletterFanHero from "@/components/marketing/NewsletterFanHero";
import styles from "@/components/marketing/landing.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <Header />
      <NewsletterFanHero />
    </main>
  );
}
