/**
 * Single source for the pricing FAQ: the visible accordion on /pricing and
 * the FAQPage JSON-LD in the page head are both generated from this list,
 * so the structured data can never drift from what's on screen (a hard
 * requirement for rich results, and what answer engines quote from).
 *
 * Answers are plain prose — no markup — because they're serialized into
 * JSON-LD verbatim.
 */
export type PricingFaqItem = {
  question: string;
  answer: string;
};

export const PRICING_FAQ: PricingFaqItem[] = [
  {
    question: "What is Pirol?",
    answer:
      "Pirol is the most comprehensive email analytics platform: a searchable archive of the marketing emails real brands send, paired with the tools to learn from them. Every email is broken down by sending platform (ESP), category and design, and you can compare across brands, countries and content with analytics dashboards and side-by-side views. If you want to know what the best brands are sending — and why it works — Pirol is where you find out.",
  },
  {
    question: "How much does Pirol cost?",
    answer:
      "Pirol has three plans: Free at €0, Solo at €30 per month (or €300 per year) for one user, and Team at €90 per month (or €900 per year) for up to 6 users. Annual billing gives you two months free.",
  },
  {
    question: "Is there a free plan?",
    answer:
      "Yes. The Free plan requires no credit card and lets you browse and search the entire archive. Emails open as previews with full breakdowns of ESP, category and design, and you can save up to 25 emails.",
  },
  {
    question: "What is the difference between the Solo and Team plans?",
    answer:
      "Both plans unlock the full archive, unlimited search, unlimited saves and collections, brand comparison and analytics dashboards. Solo is a single seat for one person; Team adds up to 6 seats, shared team collections and priority support.",
  },
  {
    question: "Do I need a credit card to get started?",
    answer:
      "No. You can create a free account and start browsing the archive without entering any payment details.",
  },
  {
    question: "What is the refund policy?",
    answer:
      "If a paid plan isn't for you, email us within 7 days of purchase and you'll get a full refund — no questions asked.",
  },
];
