import Header from "@/components/marketing/Header";
import HeroComposite from "@/components/marketing/HeroComposite";
import styles from "@/components/marketing/landing.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <Header />
      <HeroComposite />
    </main>
  );
}
