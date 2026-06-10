import styles from "./pricing.module.css";
import { PRICING_FAQ } from "@/lib/marketing/pricing-faq";

/**
 * Server-rendered FAQ accordion. Native <details>/<summary> keeps every
 * answer in the initial HTML — no JS needed — which is the point: the copy
 * exists for crawlers and answer engines, not just for users who click.
 */
export default function PricingFaq() {
  return (
    <section className={styles.faq} aria-labelledby="pricing-faq-heading">
      <h2 id="pricing-faq-heading" className={styles.faqTitle}>
        Frequently asked questions
      </h2>
      <div className={styles.faqList}>
        {PRICING_FAQ.map((item) => (
          <details key={item.question} className={styles.faqItem}>
            <summary className={styles.faqQuestion}>
              {item.question}
              <svg
                className={styles.faqChevron}
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m6 8 4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <p className={styles.faqAnswer}>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
