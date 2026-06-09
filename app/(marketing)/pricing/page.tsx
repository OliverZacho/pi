import type { Metadata } from "next";
import Header from "@/components/marketing/Header";
import Pricing from "@/components/marketing/Pricing";
import styles from "@/components/marketing/landing.module.css";

export const metadata: Metadata = {
  title: "Pricing — Pirol",
  description:
    "One plan unlocks the entire archive — every email, every brand, every dashboard.",
};

export default function PricingPage() {
  return (
    <main className={styles.page}>
      <Header />
      <Pricing />
    </main>
  );
}
