import Header from "@/components/marketing/Header";
import Hero from "@/components/marketing/Hero";
import SplitRevealHero from "@/components/marketing/SplitRevealHero";
import styles from "@/components/marketing/landing.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <Header />
      <Hero />
      <SplitRevealHero />
    </main>
  );
}
