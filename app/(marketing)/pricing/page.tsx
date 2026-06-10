import type { Metadata } from "next";
import Header from "@/components/marketing/Header";
import Pricing from "@/components/marketing/Pricing";
import PricingFaq from "@/components/marketing/PricingFaq";
import { PRICING_FAQ } from "@/lib/marketing/pricing-faq";
import styles from "@/components/marketing/landing.module.css";

export const metadata: Metadata = {
  title: "Pricing — Pirol",
  description:
    "Start free, no card required. One upgrade unlocks the entire archive — every email, every brand, every dashboard.",
};

// FAQPage structured data, built from the same list the visible FAQ renders.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: PRICING_FAQ.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default function PricingPage() {
  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Header />
      <Pricing />
      <PricingFaq />
    </main>
  );
}
