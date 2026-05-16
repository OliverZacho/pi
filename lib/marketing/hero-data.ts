/**
 * Hero showcase data for the Split Reveal landing page hero.
 *
 * Sourced from a real captured email in the Pirol database:
 *   captured_emails.id = '7002d123-edc8-4669-a4db-990a3ba56e08'
 *   brand = HAY, subject = "Take dining outside", sent_at = 2026-05-15 11:00 UTC
 *
 * Analytics (send_time_chart, competitors_in_window, etc.) were computed
 * over all captured_emails in Europe/Copenhagen timezone via execute_sql.
 *
 * Kept as static constants so the landing page stays statically prerendered
 * (no per-request DB call). Re-run the queries in lib/marketing/README to
 * refresh, or migrate to ISR when the hero email rotates.
 */

export type HeroEmail = {
  id: string;
  brand: {
    name: string;
    domain: string;
    logoSrc: string;
    logoAlt: string;
  };
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  cta: { label: string; href: string };
  heroImage: { src: string; alt: string };
  productImages: { src: string; alt: string }[];
  footerLinks: { label: string; href: string }[];
  sentAt: string;
  esp: { provider: string; label: string };
};

export type HeroAnalytics = {
  palette: { hex: string; label: string }[];
  fonts: { name: string; role: string }[];
  sendTime: {
    hourLabel: string;
    timezone: string;
    chart: { hour: number; count: number; highlighted: boolean }[];
  };
  competitorWindow: {
    count: number;
    windowLabel: string;
    sampleBrands: string[];
  };
  signals: {
    hasDarkMode: boolean;
    hasGif: boolean;
    imageCount: number;
    category: string;
  };
};

// ---- The HAY "Take dining outside" newsletter ----
export const HERO_EMAIL: HeroEmail = {
  id: "7002d123-edc8-4669-a4db-990a3ba56e08",
  brand: {
    name: "HAY",
    domain: "hay.com",
    logoSrc: "https://images.apsis.one/d284af99-2ad5-4c6c-b2d2-379a73c7b4a9.png",
    logoAlt: "HAY"
  },
  subject: "Take dining outside",
  preheader: "Outdoor dining season starts here.",
  heading: "DINING OUTDOORS",
  body: "Longer evenings call for slower meals, shared outside. Discover a selection of HAY's outdoor dining essentials – from the new Palissade Cantilever to glazed Barro tableware, parasols, and soft textiles from the Terrazza collection. Everything that makes a table feel ready for guests.",
  cta: { label: "Discover more", href: "#" },
  heroImage: {
    src: "https://images.apsis.one/272216e3-3c34-4611-a458-08a0479540de.jpeg",
    alt: "HAY outdoor dining setup with Palissade chairs"
  },
  productImages: [
    {
      src: "https://images.apsis.one/9d09ffe1-52b7-40d7-b8eb-84e474933f40.jpeg",
      alt: "Palissade Cantilever"
    },
    {
      src: "https://images.apsis.one/66acc0b2-dcaf-4950-8647-5daaa8fe5703.jpeg",
      alt: "Barro tableware"
    }
  ],
  footerLinks: [
    { label: "About HAY", href: "#" },
    { label: "Find store", href: "#" }
  ],
  sentAt: "2026-05-15T11:00:40.681Z",
  esp: { provider: "apsis", label: "Apsis One" }
};

// ---- Analytics that the right-side panel reveals as the page loads ----
export const HERO_ANALYTICS: HeroAnalytics = {
  // Palette: hand-tuned from the actual newsletter imagery
  // (terracotta tableware, olive Palissade, cream linens, charcoal type).
  // Will be replaced by vision-extracted colors once the pipeline lands.
  palette: [
    { hex: "#1A1A1A", label: "Charcoal" },
    { hex: "#5E6E4A", label: "Palissade olive" },
    { hex: "#B86F4C", label: "Barro terracotta" },
    { hex: "#C8B594", label: "Linen" },
    { hex: "#F4EFE3", label: "Off-white" }
  ],
  // Fonts: parsed from the email's inline style attributes.
  fonts: [
    { name: "Arial", role: "Headings" },
    { name: "Helvetica", role: "Headings fallback" },
    { name: "Verdana", role: "Body" }
  ],
  // Send time: hour distribution across all captured_emails in
  // Europe/Copenhagen time; HAY's email lands in the 13:00 bar.
  sendTime: {
    hourLabel: "13:00",
    timezone: "CEST",
    chart: [
      { hour: 6, count: 2, highlighted: false },
      { hour: 7, count: 1, highlighted: false },
      { hour: 8, count: 1, highlighted: false },
      { hour: 9, count: 5, highlighted: false },
      { hour: 10, count: 8, highlighted: false },
      { hour: 11, count: 11, highlighted: false },
      { hour: 12, count: 2, highlighted: false },
      { hour: 13, count: 4, highlighted: true },
      { hour: 14, count: 2, highlighted: false },
      { hour: 15, count: 7, highlighted: false },
      { hour: 16, count: 3, highlighted: false },
      { hour: 18, count: 1, highlighted: false },
      { hour: 19, count: 3, highlighted: false },
      { hour: 20, count: 17, highlighted: false },
      { hour: 21, count: 4, highlighted: false }
    ]
  },
  // ±1 hour window in Copenhagen time around HAY's 13:00 send.
  // Computed query: 5 distinct competitor brands.
  competitorWindow: {
    count: 5,
    windowLabel: "12:00 – 14:00 CEST",
    sampleBrands: ["Hübsch", "New Works", "Norr11", "Rosendahl", "Zara Home"]
  },
  signals: {
    hasDarkMode: false,
    hasGif: true,
    imageCount: 9,
    category: "products"
  }
};
