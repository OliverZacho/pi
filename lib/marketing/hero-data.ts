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

// ---- A shared 24-hour send-time distribution ----
// Pulled from captured_emails in Europe/Copenhagen time. The same shape
// is shown for every email — only the highlighted hour shifts to match
// the currently-displayed brand's send slot, so the eye sees "their"
// bar light up.
type ChartBar = { hour: number; count: number; highlighted: boolean };

const SEND_TIME_DISTRIBUTION: { hour: number; count: number }[] = [
  { hour: 6, count: 2 },
  { hour: 7, count: 1 },
  { hour: 8, count: 8 },
  { hour: 9, count: 7 },
  { hour: 10, count: 8 },
  { hour: 11, count: 11 },
  { hour: 12, count: 2 },
  { hour: 13, count: 4 },
  { hour: 14, count: 2 },
  { hour: 15, count: 7 },
  { hour: 16, count: 3 },
  { hour: 18, count: 1 },
  { hour: 19, count: 3 },
  { hour: 20, count: 17 },
  { hour: 21, count: 4 }
];

function chartWithHighlight(highlightedHour: number): ChartBar[] {
  return SEND_TIME_DISTRIBUTION.map((b) => ({
    ...b,
    highlighted: b.hour === highlightedHour
  }));
}

// ---- 1. HAY — "Take dining outside" ----
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
    chart: chartWithHighlight(13)
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

// ---- 2. Audo Copenhagen — "Portable Lamps for Evolving Spaces" ----
export const HERO_EMAIL_AUDO: HeroEmail = {
  id: "f15538ab-51fa-4147-85ee-952aa8cfd16b",
  brand: {
    name: "Audo Copenhagen",
    domain: "audonews.com",
    logoSrc:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/f03357ca-388f-4408-bba3-34d616637772.png",
    logoAlt: "Audo Copenhagen"
  },
  subject: "Portable Lamps for Evolving Spaces",
  preheader: "Flexible by design.",
  heading: "FLEXIBLE BY DESIGN",
  body: "In restaurants, hotels, and shared interiors, portable lamps offer a considered approach to illumination. Easy to reposition and adaptable by nature, they help shape mood and define spaces while complementing the architectural rhythm of a project.",
  cta: { label: "Discover all Portable Lighting", href: "#" },
  heroImage: {
    src: "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/5fd1dafc-6ebd-42b5-8aae-52d25f4f9710.jpeg",
    alt: "Audo interior with portable lamp casting warm light"
  },
  productImages: [
    {
      src: "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/3af28dab-d220-44bc-a86d-7605bb372105.jpeg",
      alt: "Audo portable lamp"
    },
    {
      src: "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/1c5c58b6-486a-4b8e-ad29-d6e697f29f47.jpeg",
      alt: "Audo lamp in situ"
    }
  ],
  footerLinks: [
    { label: "About Audo", href: "#" },
    { label: "Stockists", href: "#" }
  ],
  sentAt: "2026-05-12T07:30:25.567Z",
  esp: { provider: "klaviyo", label: "Klaviyo" }
};

export const HERO_ANALYTICS_AUDO: HeroAnalytics = {
  palette: [
    { hex: "#2D2620", label: "Espresso" },
    { hex: "#8C6E5A", label: "Walnut" },
    { hex: "#B47645", label: "Copper" },
    { hex: "#C9B392", label: "Taupe" },
    { hex: "#E5D9C8", label: "Bone" }
  ],
  fonts: [
    { name: "Inter Display", role: "Headings" },
    { name: "Inter", role: "Body" },
    { name: "Georgia", role: "Editorial accents" }
  ],
  sendTime: {
    hourLabel: "09:30",
    timezone: "CEST",
    chart: chartWithHighlight(9)
  },
  competitorWindow: {
    count: 7,
    windowLabel: "08:30 – 10:30 CEST",
    sampleBrands: ["&Tradition", "Fritz Hansen", "HAY", "Ferm Living", "Montana", "Georg Jensen", "Rosendahl"]
  },
  signals: {
    hasDarkMode: false,
    hasGif: false,
    imageCount: 15,
    category: "products"
  }
};

// ---- 3. Ferm Living — "Free shipping on all orders ends tonight." ----
export const HERO_EMAIL_FERM: HeroEmail = {
  id: "080f1c61-dc56-41fb-8532-2ac56d7dda6e",
  brand: {
    name: "Ferm Living",
    domain: "fermliving.com",
    logoSrc:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/0603bd8d-0ef3-437d-a556-a39faccf3ed7.png",
    logoAlt: "Ferm Living"
  },
  subject: "Free shipping on all orders ends tonight.",
  preheader: "Bring home the pieces you've been considering.",
  heading: "ENDS TONIGHT",
  body: "There's still time to enjoy free shipping across our entire collection, but not for long. Bring home the pieces you've been considering, with delivery on us. Offer ends tonight.",
  cta: { label: "Shop now", href: "#" },
  heroImage: {
    src: "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/4e0359f5-5fe8-4684-8974-a28d952240c5.jpeg",
    alt: "Ferm Living free shipping promo with sage leaf"
  },
  productImages: [
    {
      src: "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/64381709-321e-4b07-bf96-48e6db42adc5.jpeg",
      alt: "Ferm Living interior"
    },
    {
      src: "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/0daa2600-e538-4913-9083-c082375a9a7a.jpeg",
      alt: "Ferm Living object"
    }
  ],
  footerLinks: [
    { label: "Our world", href: "#" },
    { label: "Stores", href: "#" }
  ],
  sentAt: "2026-05-14T06:00:15.109Z",
  esp: { provider: "klaviyo", label: "Klaviyo" }
};

export const HERO_ANALYTICS_FERM: HeroAnalytics = {
  palette: [
    { hex: "#2C3D38", label: "Forest" },
    { hex: "#5A7F70", label: "Sage" },
    { hex: "#C97B5D", label: "Clay" },
    { hex: "#D8CCB6", label: "Linen" },
    { hex: "#E8DDC5", label: "Off-white" }
  ],
  fonts: [
    { name: "GT America", role: "Headings" },
    { name: "Söhne", role: "Body" },
    { name: "Times", role: "Editorial accents" }
  ],
  sendTime: {
    hourLabel: "08:00",
    timezone: "CEST",
    chart: chartWithHighlight(8)
  },
  competitorWindow: {
    count: 6,
    windowLabel: "07:00 – 09:00 CEST",
    sampleBrands: ["&Tradition", "Audo Copenhagen", "Georg Jensen", "FDB Møbler", "Montana", "Rosendahl"]
  },
  signals: {
    hasDarkMode: false,
    hasGif: false,
    imageCount: 14,
    category: "sale"
  }
};

// ---- The rotation: three real captured newsletters paired with the
// analysis Pirol would surface for each. Consumed by HeroComposite to
// cycle through them as if a live feed were ticking past.
export type HeroSlot = { email: HeroEmail; analytics: HeroAnalytics };

export const HERO_ROTATION: HeroSlot[] = [
  { email: HERO_EMAIL, analytics: HERO_ANALYTICS },
  { email: HERO_EMAIL_AUDO, analytics: HERO_ANALYTICS_AUDO },
  { email: HERO_EMAIL_FERM, analytics: HERO_ANALYTICS_FERM }
];
