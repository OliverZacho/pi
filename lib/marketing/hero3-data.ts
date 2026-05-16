/**
 * Data for the "Scrolling Intelligence Feed" hero (/hero3).
 *
 * Four real newsletters (queried from `captured_emails`) scroll
 * upwards continuously. The right-edge data panel updates whenever
 * a different newsletter passes through the centre of the viewport.
 *
 * Subjects, preheaders, body copy and send times are real values from
 * the database. Color palettes and typefaces are hand-picked / inferred
 * from the rendered hero imagery and brand identity — these are the
 * kind of insights Pirol's analysis layer would extract.
 */

export type NewsletterColor = { hex: string; label?: string };

export type FeedNewsletter = {
  id: string;
  brand: string;
  brandMark: string; // logo URL
  brandTone: string; // tagline-style descriptor used in body header
  subject: string;
  preheader: string;
  body: string; // 1–3 sentence excerpt
  ctaText: string;
  heroImage: string;
  heroImageAlt: string;

  // Insight data extracted by Pirol's analysis layer
  sentLocal: string; // "Fri 13:00"
  sentDay: string; // "Friday"
  esp: string; // "Apsis · Sweden"
  typeface: string; // "Söhne"
  subjectLength: number;
  imageCount: number;
  palette: NewsletterColor[];

  // Card styling — different brands have different paper/background tones
  paperBg: string; // background color of the email card
  paperInk: string; // text color
};

export const FEED_NEWSLETTERS: FeedNewsletter[] = [
  {
    id: "7002d123-edc8-4669-a4db-990a3ba56e08",
    brand: "HAY",
    brandMark: "https://images.apsis.one/d284af99-2ad5-4c6c-b2d2-379a73c7b4a9.png",
    brandTone: "Copenhagen · Design",
    subject: "Take dining outside",
    preheader: "Outdoor dining season starts here.",
    body:
      "Longer evenings call for slower meals, shared outside. Discover a selection of HAY's outdoor dining essentials — from the new Palissade Cantilever to glazed Barro tableware, parasols, and soft textiles from the Terrazza collection. Everything that makes a table feel ready for guests.",
    ctaText: "Discover more",
    heroImage:
      "https://images.apsis.one/272216e3-3c34-4611-a458-08a0479540de.jpeg",
    heroImageAlt: "HAY outdoor dining setup with terracotta tableware",
    sentLocal: "Fri 13:00",
    sentDay: "Friday",
    esp: "Apsis One · SE",
    typeface: "Söhne",
    subjectLength: 19,
    imageCount: 13,
    palette: [
      { hex: "#B86F4C", label: "Terracotta" },
      { hex: "#D9C9B0", label: "Cream" },
      { hex: "#6B7359", label: "Sage" },
      { hex: "#2A2723", label: "Espresso" },
      { hex: "#E8DCC9", label: "Sand" }
    ],
    paperBg: "#f6efe5",
    paperInk: "#1a1814"
  },
  {
    id: "f15538ab-51fa-4147-85ee-952aa8cfd16b",
    brand: "Audo Copenhagen",
    brandMark:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/f03357ca-388f-4408-bba3-34d616637772.png",
    brandTone: "Flexible by design",
    subject: "Portable Lamps for Evolving Spaces",
    preheader: "FLEXIBLE BY DESIGN",
    body:
      "In restaurants, hotels, and shared interiors, portable lamps offer a considered approach to illumination. Easy to reposition and adaptable by nature, they help shape mood and define spaces while complementing the architectural rhythm of a project.",
    ctaText: "Discover all Portable Lighting",
    heroImage:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/5fd1dafc-6ebd-42b5-8aae-52d25f4f9710.jpeg",
    heroImageAlt: "Audo interior with portable lamp casting warm light",
    sentLocal: "Tue 09:30",
    sentDay: "Tuesday",
    esp: "Klaviyo · US",
    typeface: "Inter Display",
    subjectLength: 34,
    imageCount: 15,
    palette: [
      { hex: "#B47645", label: "Copper" },
      { hex: "#8C6E5A", label: "Walnut" },
      { hex: "#E5D9C8", label: "Bone" },
      { hex: "#2D2620", label: "Espresso" },
      { hex: "#C9B392", label: "Taupe" }
    ],
    paperBg: "#ede6da",
    paperInk: "#1f1b16"
  },
  {
    id: "080f1c61-dc56-41fb-8532-2ac56d7dda6e",
    brand: "Ferm Living",
    brandMark:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/0603bd8d-0ef3-437d-a556-a39faccf3ed7.png",
    brandTone: "New collection · SS26",
    subject: "Free shipping on all orders ends tonight.",
    preheader: "Bring home the pieces you've been considering.",
    body:
      "There's still time to enjoy free shipping across our entire collection, but not for long. Bring home the pieces you've been considering, with delivery on us. Offer ends tonight.",
    ctaText: "Shop Now",
    heroImage:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/4e0359f5-5fe8-4684-8974-a28d952240c5.jpeg",
    heroImageAlt: "Ferm Living free shipping promo with sage leaf",
    sentLocal: "Thu 08:00",
    sentDay: "Thursday",
    esp: "Klaviyo · US",
    typeface: "GT America",
    subjectLength: 41,
    imageCount: 14,
    palette: [
      { hex: "#5A7F70", label: "Sage" },
      { hex: "#D8CCB6", label: "Linen" },
      { hex: "#2C3D38", label: "Forest" },
      { hex: "#E8DDC5", label: "Off-white" },
      { hex: "#C97B5D", label: "Clay" }
    ],
    paperBg: "#f4ede0",
    paperInk: "#1c211f"
  },
  {
    id: "a89a84cb-bfec-43be-85ed-6a9ddeff73fa",
    brand: "Hübsch",
    brandMark:
      "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2023/05/04/206ee2d3-1c26-4906-8342-cec02e5dcf71.png",
    brandTone: "Hübsch Interior · DK",
    subject: "New summer season highlights",
    preheader: "Portable lamps, accessories and more for the outdoor season.",
    body:
      "As the days grow longer, everyday life moves outdoors. Morning coffee in the sun, slow dinners on the terrace, quiet evenings in the garden. This season brings new inspiration for open-air living, with thoughtfully designed pieces for terraces, balconies, gardens, and courtyards.",
    ctaText: "Explore Season's News",
    heroImage:
      "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2026/05/11/b6647f70-dcc1-487c-a5af-34e93ebb73e7.jpeg",
    heroImageAlt: "Hübsch summer outdoor scene",
    sentLocal: "Thu 12:00",
    sentDay: "Thursday",
    esp: "ActiveCampaign · US",
    typeface: "Söhne",
    subjectLength: 28,
    imageCount: 11,
    palette: [
      { hex: "#C8A07A", label: "Beige" },
      { hex: "#F1E8D9", label: "Cream" },
      { hex: "#6B7359", label: "Olive" },
      { hex: "#8A8175", label: "Stone" },
      { hex: "#3F3A33", label: "Charcoal" }
    ],
    paperBg: "#f3ecde",
    paperInk: "#1a1814"
  }
];

// Starting value for the "live" emails-analyzed counter that ticks up
// quietly throughout the animation.
export const LIVE_COUNTER_START = 18432;
