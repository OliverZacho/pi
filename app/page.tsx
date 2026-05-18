import Header from "@/components/marketing/Header";
import IconStreamHero from "@/components/marketing/IconStreamHero";
import styles from "@/components/marketing/landing.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <Header />
      <IconStreamHero />
    </main>
  );
}
