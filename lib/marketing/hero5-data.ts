/**
 * Data for the "Timeline" hero (/hero5).
 *
 * Each brand has 6–12 months of newsletter sends plotted on a single
 * horizontal axis. The point of the page is to make patterns in
 * competitor email history visually unavoidable:
 *
 *   - HAY ships on Tuesdays. You can see it.
 *   - HAY went quiet for three weeks in August. You can see it.
 *   - HAY rebranded in October. You can see it.
 *
 * The dataset is curated rather than pulled live so the patterns are
 * cleanly readable in the hero. In production the same component would
 * be fed by the database aggregator on a per-brand basis.
 */
export type TimelineCategory =
  | "launch"
  | "campaign"
  | "sale"
  | "editorial"
  | "announcement";

export type TimelineSend = {
  id: string;
  /** ISO date, e.g. "2025-04-08". Day of week is derived. */
  date: string;
  subject: string;
  preheader?: string;
  category: TimelineCategory;
  /** Background of the lift-up card thumbnail. */
  paperBg: string;
  /** Foreground/ink color on that thumbnail. */
  paperInk: string;
  /** Dot color on the axis; usually the brand's primary accent. */
  accent: string;
  /** Optional small color block shown in the lift-up card. */
  swatches?: string[];
  /** Optional real hero image for the card thumbnail. */
  heroImage?: string;
};

export type TimelineAnnotation = {
  /** Inclusive start date the annotation spans across. */
  start: string;
  /** Inclusive end date. For a point-in-time note, set end === start. */
  end: string;
  label: string;
  tone: "quiet" | "shift" | "surge";
};

export type TimelineInsight = {
  label: string;
  value: string;
};

export type TimelineBrand = {
  id: string;
  name: string;
  brandMark: string;
  cadence: string;
  /** Optional URL to a small wordmark used on the lift-up card. */
  wordmark?: string;
  /** ISO start of the visible timeline window. */
  windowStart: string;
  /** ISO end of the visible timeline window. */
  windowEnd: string;
  sends: TimelineSend[];
  annotations: TimelineAnnotation[];
  insights: TimelineInsight[];
  /** Indices of sends to feature in the auto-tour, in order. */
  tour: number[];
};

// ---------------------------------------------------------------------------
// Brand 1 — HAY (the headline story: weekly Tuesdays, quiet August, Oct refresh)
// ---------------------------------------------------------------------------

const HAY_CREAM: TimelineSend["paperBg"] = "#f4ecdd";
const HAY_INK: TimelineSend["paperInk"] = "#1a1814";
const HAY_TERRACOTTA = "#b86f4c";
const HAY_SAGE = "#6b7359";
const HAY_SAND = "#e8dcc9";
const HAY_ESPRESSO = "#2a2723";
const HAY_BUTTER = "#e9c46a";
const HAY_COBALT = "#3057a8";

// Post-refresh palette (October onward) — bolder, more saturated.
const HAY_REBRAND_BG = "#171514";
const HAY_REBRAND_INK = "#f4ecdd";
const HAY_REBRAND_ACCENT = "#e35a2a";

const haySends: TimelineSend[] = [
  // ---- Jan ----
  {
    id: "hay-001",
    date: "2025-01-07",
    subject: "Hello 2025 — the year in colour",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
    swatches: [HAY_TERRACOTTA, HAY_SAND, HAY_SAGE, HAY_ESPRESSO],
  },
  {
    id: "hay-002",
    date: "2025-01-14",
    subject: "Mags Soft, now in three new tones",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
    swatches: [HAY_SAGE, HAY_SAND, HAY_ESPRESSO],
  },
  {
    id: "hay-003",
    date: "2025-01-21",
    subject: "The studio at home — workspace edit",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_BUTTER,
    swatches: [HAY_BUTTER, HAY_SAND, HAY_ESPRESSO],
  },
  {
    id: "hay-004",
    date: "2025-01-28",
    subject: "Last day · Winter sale ends tonight",
    category: "sale",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
    swatches: [HAY_TERRACOTTA, HAY_SAND],
  },
  // ---- Feb ----
  {
    id: "hay-005",
    date: "2025-02-04",
    subject: "Palissade outdoors — first look at SS25",
    category: "campaign",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
    swatches: [HAY_SAGE, HAY_SAND, HAY_ESPRESSO],
  },
  {
    id: "hay-006",
    date: "2025-02-11",
    subject: "AAC chair: nine seats, one base",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_ESPRESSO,
  },
  {
    id: "hay-007",
    date: "2025-02-18",
    subject: "Storage, sorted — a guide to Colour Crate",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_COBALT,
    swatches: [HAY_COBALT, HAY_SAND, HAY_ESPRESSO],
  },
  {
    id: "hay-008",
    date: "2025-02-25",
    subject: "Take five — the new lounge collection",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
  },
  // ---- Mar ----
  {
    id: "hay-009",
    date: "2025-03-04",
    subject: "Salone preview · Milan 2025",
    category: "campaign",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
    swatches: [HAY_TERRACOTTA, HAY_SAND, HAY_SAGE],
  },
  {
    id: "hay-010",
    date: "2025-03-11",
    subject: "Soft Edge in three new finishes",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_BUTTER,
  },
  {
    id: "hay-011",
    date: "2025-03-18",
    subject: "How we made it — Slit Table at five years",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_ESPRESSO,
  },
  {
    id: "hay-012",
    date: "2025-03-25",
    subject: "Spring tableware drop",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
    swatches: [HAY_SAGE, HAY_SAND],
  },
  // ---- Apr ----
  {
    id: "hay-013",
    date: "2025-04-01",
    subject: "Milan ’25 — the full HAY house",
    category: "campaign",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
    swatches: [HAY_TERRACOTTA, HAY_SAGE, HAY_SAND, HAY_ESPRESSO],
  },
  {
    id: "hay-014",
    date: "2025-04-08",
    subject: "Pao terracotta · only in April",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
  },
  {
    id: "hay-015",
    date: "2025-04-15",
    subject: "Outdoor essentials — Palissade lookbook",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
    swatches: [HAY_SAGE, HAY_SAND, HAY_ESPRESSO],
  },
  {
    id: "hay-016",
    date: "2025-04-22",
    subject: "Earth Day · materials we’re proud of",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
  },
  // ---- May ----
  {
    id: "hay-017",
    date: "2025-05-06",
    subject: "Take dining outside",
    preheader: "Outdoor dining season starts here.",
    category: "campaign",
    paperBg: "#f6efe5",
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
    swatches: [HAY_TERRACOTTA, "#d9c9b0", HAY_SAGE, HAY_ESPRESSO, HAY_SAND],
    heroImage:
      "https://images.apsis.one/272216e3-3c34-4611-a458-08a0479540de.jpeg",
  },
  {
    id: "hay-018",
    date: "2025-05-13",
    subject: "Soap dispensers, restocked",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_COBALT,
  },
  {
    id: "hay-019",
    date: "2025-05-20",
    subject: "On view · A Spring at HAY House",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_BUTTER,
  },
  {
    id: "hay-020",
    date: "2025-05-27",
    subject: "Don’t miss · Designer Sale up to 40%",
    category: "sale",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
  },
  // ---- Jun ----
  {
    id: "hay-021",
    date: "2025-06-03",
    subject: "Sale extended — final 48 hours",
    category: "sale",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
  },
  {
    id: "hay-022",
    date: "2025-06-10",
    subject: "Now arriving · Soft Pad in cognac",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
    swatches: [HAY_TERRACOTTA, HAY_SAND],
  },
  {
    id: "hay-023",
    date: "2025-06-17",
    subject: "Summer reading from the HAY studio",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_ESPRESSO,
  },
  {
    id: "hay-024",
    date: "2025-06-24",
    subject: "Last orders before summer dispatch",
    category: "announcement",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_BUTTER,
  },
  // ---- Jul ----
  {
    id: "hay-025",
    date: "2025-07-08",
    subject: "Travelling well · accessories on the move",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
  },
  {
    id: "hay-026",
    date: "2025-07-22",
    subject: "Mid-summer offers · this week only",
    category: "sale",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_TERRACOTTA,
  },
  // ---- (Quiet August — no sends, by design) ----
  // ---- Sep ----
  {
    id: "hay-027",
    date: "2025-09-02",
    subject: "Back in studio — what we’ve been working on",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_SAGE,
  },
  {
    id: "hay-028",
    date: "2025-09-09",
    subject: "3 Days of Design recap",
    category: "editorial",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_BUTTER,
  },
  {
    id: "hay-029",
    date: "2025-09-16",
    subject: "AW25 first look · a quieter palette",
    category: "campaign",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_ESPRESSO,
    swatches: [HAY_ESPRESSO, HAY_SAGE, HAY_SAND],
  },
  {
    id: "hay-030",
    date: "2025-09-23",
    subject: "Apex lamp · made for long evenings",
    category: "launch",
    paperBg: HAY_CREAM,
    paperInk: HAY_INK,
    accent: HAY_ESPRESSO,
  },
  {
    id: "hay-031",
    date: "2025-09-30",
    subject: "Something’s coming · October 14",
    category: "announcement",
    paperBg: HAY_ESPRESSO,
    paperInk: HAY_SAND,
    accent: HAY_REBRAND_ACCENT,
  },
  // ---- Oct (brand refresh on the 14th) ----
  {
    id: "hay-032",
    date: "2025-10-07",
    subject: "One week to go",
    category: "announcement",
    paperBg: HAY_ESPRESSO,
    paperInk: HAY_SAND,
    accent: HAY_REBRAND_ACCENT,
  },
  {
    id: "hay-033",
    date: "2025-10-14",
    subject: "A new HAY — every detail, reset",
    category: "campaign",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
    swatches: [HAY_REBRAND_ACCENT, HAY_SAND, HAY_REBRAND_INK, HAY_ESPRESSO],
  },
  {
    id: "hay-034",
    date: "2025-10-21",
    subject: "The new shop, the new site, the new us",
    category: "campaign",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
  {
    id: "hay-035",
    date: "2025-10-28",
    subject: "AW25 collection · now available",
    category: "launch",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
    swatches: [HAY_REBRAND_ACCENT, HAY_SAND, HAY_REBRAND_INK],
  },
  // ---- Nov ----
  {
    id: "hay-036",
    date: "2025-11-04",
    subject: "Gift guide · designed for under €100",
    category: "editorial",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
  {
    id: "hay-037",
    date: "2025-11-11",
    subject: "Black Week · early access for members",
    category: "sale",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
  {
    id: "hay-038",
    date: "2025-11-18",
    subject: "Black Friday is live · up to 30%",
    category: "sale",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
    swatches: [HAY_REBRAND_ACCENT, HAY_SAND],
  },
  {
    id: "hay-039",
    date: "2025-11-21",
    subject: "Black Friday · last call",
    category: "sale",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
  {
    id: "hay-040",
    date: "2025-11-25",
    subject: "Cyber Monday · the final markdowns",
    category: "sale",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
  // ---- Dec ----
  {
    id: "hay-041",
    date: "2025-12-02",
    subject: "Last orders before Christmas",
    category: "announcement",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
  {
    id: "hay-042",
    date: "2025-12-09",
    subject: "Holiday hosting · the table edit",
    category: "editorial",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
  {
    id: "hay-043",
    date: "2025-12-16",
    subject: "Studio closing dates",
    category: "announcement",
    paperBg: HAY_REBRAND_BG,
    paperInk: HAY_REBRAND_INK,
    accent: HAY_REBRAND_ACCENT,
  },
];

// ---------------------------------------------------------------------------
// Brand 2 — Ferm Living (high-volume, sales-heavy, multiple campaign clusters)
// ---------------------------------------------------------------------------

const FERM_BG = "#f3ece0";
const FERM_INK = "#1c211f";
const FERM_SAGE = "#5a7f70";
const FERM_FOREST = "#2c3d38";
const FERM_CLAY = "#c97b5d";
const FERM_LINEN = "#d8ccb6";

const fermSends: TimelineSend[] = [
  { id: "fl-01", date: "2025-04-03", subject: "AW25 styling notes from the studio", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_SAGE },
  { id: "fl-02", date: "2025-04-10", subject: "Welcome to the Home of Ferm Living", category: "announcement", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-03", date: "2025-04-17", subject: "Community Favourites · April", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-04", date: "2025-04-24", subject: "Introducing our Baby Collection", category: "launch", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_LINEN, swatches: [FERM_LINEN, FERM_SAGE, FERM_FOREST] },
  { id: "fl-05", date: "2025-05-01", subject: "A Better Tomorrow — 2025 Responsibility Report", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-06", date: "2025-05-08", subject: "Free shipping ends tonight", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-07", date: "2025-05-15", subject: "Outdoor sanctuary · garden lookbook", category: "campaign", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_SAGE, swatches: [FERM_SAGE, FERM_LINEN, FERM_FOREST] },
  { id: "fl-08", date: "2025-05-22", subject: "Bringing the table outside", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_SAGE },
  { id: "fl-09", date: "2025-05-29", subject: "Mid-season offers · up to 25%", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-10", date: "2025-06-05", subject: "3 Days of Design · join us in Copenhagen", category: "announcement", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-11", date: "2025-06-12", subject: "Now arriving · Pond mirror in oak", category: "launch", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_LINEN },
  { id: "fl-12", date: "2025-06-19", subject: "Inside Trine Andersen’s home", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-13", date: "2025-06-26", subject: "Summer sale starts now · up to 40%", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY, swatches: [FERM_CLAY, FERM_LINEN] },
  { id: "fl-14", date: "2025-07-03", subject: "Summer sale · 50% on selected styles", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-15", date: "2025-07-10", subject: "Holiday house · summer styling", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_SAGE },
  { id: "fl-16", date: "2025-07-24", subject: "Last days of summer sale", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-17", date: "2025-08-21", subject: "We’re back · what’s new", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-18", date: "2025-09-04", subject: "AW25 collection · first drop", category: "launch", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST, swatches: [FERM_FOREST, FERM_LINEN, FERM_CLAY] },
  { id: "fl-19", date: "2025-09-11", subject: "Throws, knits and quiet evenings", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_LINEN },
  { id: "fl-20", date: "2025-09-18", subject: "The Pond chair, now in stone", category: "launch", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_LINEN },
  { id: "fl-21", date: "2025-09-25", subject: "Member preview · gift guide", category: "campaign", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-22", date: "2025-10-02", subject: "Holiday entertaining edit", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-23", date: "2025-10-09", subject: "Now arriving · Christmas decorations", category: "launch", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-24", date: "2025-10-16", subject: "Designer favourites · under €150", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-25", date: "2025-10-23", subject: "Gift guide · for the host", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_LINEN },
  { id: "fl-26", date: "2025-10-30", subject: "Black Week · early access opens Friday", category: "announcement", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-27", date: "2025-11-06", subject: "Black Week · 20% on everything", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-28", date: "2025-11-13", subject: "Black Friday · 25% sitewide", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY, swatches: [FERM_CLAY, FERM_LINEN] },
  { id: "fl-29", date: "2025-11-17", subject: "Black Friday · two days left", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-30", date: "2025-11-20", subject: "Cyber Monday · final markdowns", category: "sale", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-31", date: "2025-11-27", subject: "Last orders for Christmas delivery", category: "announcement", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-32", date: "2025-12-04", subject: "Holiday table inspiration", category: "editorial", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
  { id: "fl-33", date: "2025-12-11", subject: "Last call · ship-by-Christmas", category: "announcement", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_CLAY },
  { id: "fl-34", date: "2025-12-18", subject: "Studio holiday hours", category: "announcement", paperBg: FERM_BG, paperInk: FERM_INK, accent: FERM_FOREST },
];

// ---------------------------------------------------------------------------
// Brand 3 — Audo Copenhagen (slow, considered, one a month, no sales)
// ---------------------------------------------------------------------------

const AUDO_BG = "#ede6da";
const AUDO_INK = "#1f1b16";
const AUDO_COPPER = "#b47645";
const AUDO_WALNUT = "#8c6e5a";
const AUDO_BONE = "#e5d9c8";
const AUDO_ESPRESSO = "#2d2620";

const audoSends: TimelineSend[] = [
  { id: "au-01", date: "2025-03-11", subject: "Notes from the Townhouse", category: "editorial", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_WALNUT },
  { id: "au-02", date: "2025-04-08", subject: "Portable Lamps for Evolving Spaces", category: "launch", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_COPPER, swatches: [AUDO_COPPER, AUDO_BONE, AUDO_ESPRESSO] },
  { id: "au-03", date: "2025-05-13", subject: "On view · Audo at Milan Design Week", category: "campaign", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_ESPRESSO },
  { id: "au-04", date: "2025-06-10", subject: "Inside the Townhouse · summer", category: "editorial", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_WALNUT },
  { id: "au-05", date: "2025-07-08", subject: "Sengu Bench in oiled oak", category: "launch", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_COPPER },
  { id: "au-06", date: "2025-09-09", subject: "AW25 from the Townhouse", category: "editorial", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_ESPRESSO },
  { id: "au-07", date: "2025-10-14", subject: "Tearoom rituals · the new tableware", category: "launch", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_COPPER, swatches: [AUDO_COPPER, AUDO_BONE] },
  { id: "au-08", date: "2025-11-11", subject: "Considered gifting · for hosts", category: "editorial", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_WALNUT },
  { id: "au-09", date: "2025-12-09", subject: "Year in objects · 2025", category: "editorial", paperBg: AUDO_BG, paperInk: AUDO_INK, accent: AUDO_ESPRESSO },
];

// ---------------------------------------------------------------------------
// Brand 4 — Hübsch (mid-volume, themed monthly campaigns)
// ---------------------------------------------------------------------------

const HUB_BG = "#f1e8d9";
const HUB_INK = "#1a1814";
const HUB_BEIGE = "#c8a07a";
const HUB_OLIVE = "#6b7359";
const HUB_STONE = "#8a8175";
const HUB_CHARCOAL = "#3f3a33";

const hubSends: TimelineSend[] = [
  { id: "hb-01", date: "2025-02-13", subject: "January reset · the new minimalist", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_STONE },
  { id: "hb-02", date: "2025-03-06", subject: "Spring 2025 first look", category: "campaign", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_OLIVE, swatches: [HUB_OLIVE, HUB_BEIGE, HUB_CHARCOAL] },
  { id: "hb-03", date: "2025-03-27", subject: "Lighting that softens the room", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_BEIGE },
  { id: "hb-04", date: "2025-04-10", subject: "Easter colours · table styling", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_BEIGE },
  { id: "hb-05", date: "2025-04-24", subject: "Spring sale · selected pieces", category: "sale", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_CHARCOAL },
  { id: "hb-06", date: "2025-05-08", subject: "Summer season highlights", category: "campaign", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_OLIVE, swatches: [HUB_OLIVE, HUB_BEIGE, HUB_STONE] },
  { id: "hb-07", date: "2025-05-22", subject: "Outdoor living, the Danish way", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_OLIVE },
  { id: "hb-08", date: "2025-06-12", subject: "3 Days of Design preview", category: "announcement", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_CHARCOAL },
  { id: "hb-09", date: "2025-06-26", subject: "Summer sale · ends Sunday", category: "sale", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_CHARCOAL },
  { id: "hb-10", date: "2025-07-17", subject: "Portable lamps for outdoor evenings", category: "launch", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_BEIGE, swatches: [HUB_BEIGE, HUB_STONE] },
  { id: "hb-11", date: "2025-08-28", subject: "Returning from the studio break", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_STONE },
  { id: "hb-12", date: "2025-09-11", subject: "AW25 — the warm minimalism issue", category: "campaign", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_CHARCOAL, swatches: [HUB_CHARCOAL, HUB_BEIGE, HUB_OLIVE] },
  { id: "hb-13", date: "2025-09-25", subject: "Layered textiles for autumn", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_BEIGE },
  { id: "hb-14", date: "2025-10-16", subject: "Hosting season · the table edit", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_OLIVE },
  { id: "hb-15", date: "2025-10-30", subject: "Gift guide · designed for giving", category: "campaign", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_CHARCOAL },
  { id: "hb-16", date: "2025-11-13", subject: "Black Week · 15% on everything", category: "sale", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_CHARCOAL },
  { id: "hb-17", date: "2025-11-27", subject: "Holiday styling · advent in light", category: "editorial", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_BEIGE },
  { id: "hb-18", date: "2025-12-11", subject: "Last orders for Christmas", category: "announcement", paperBg: HUB_BG, paperInk: HUB_INK, accent: HUB_CHARCOAL },
];

// ---------------------------------------------------------------------------
// Brand objects
// ---------------------------------------------------------------------------

export const TIMELINE_BRANDS: TimelineBrand[] = [
  {
    id: "hay",
    name: "HAY",
    brandMark: "https://images.apsis.one/d284af99-2ad5-4c6c-b2d2-379a73c7b4a9.png",
    cadence: "Tuesdays · ~10:00 CET",
    windowStart: "2025-01-01",
    windowEnd: "2025-12-31",
    sends: haySends,
    annotations: [
      {
        start: "2025-07-23",
        end: "2025-09-01",
        label: "Quiet · 41 days",
        tone: "quiet",
      },
      {
        start: "2025-10-14",
        end: "2025-10-14",
        label: "Brand refresh",
        tone: "shift",
      },
      {
        start: "2025-11-18",
        end: "2025-11-25",
        label: "Black Friday surge",
        tone: "surge",
      },
    ],
    insights: [
      { label: "Total sends", value: "43" },
      { label: "Send day", value: "Tuesday · 88%" },
      { label: "Average gap", value: "8.1 days" },
      { label: "Design shifts", value: "1 (Oct 14)" },
    ],
    tour: [0, 16, 26, 32, 37, 42],
  },
  {
    id: "ferm-living",
    name: "Ferm Living",
    brandMark:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WJ7sXi/images/0603bd8d-0ef3-437d-a556-a39faccf3ed7.png",
    cadence: "Thursdays · ~08:00 CET",
    windowStart: "2025-04-01",
    windowEnd: "2025-12-31",
    sends: fermSends,
    annotations: [
      {
        start: "2025-07-24",
        end: "2025-08-21",
        label: "Quiet · 28 days",
        tone: "quiet",
      },
      {
        start: "2025-11-13",
        end: "2025-11-20",
        label: "Black Friday surge",
        tone: "surge",
      },
    ],
    insights: [
      { label: "Total sends", value: "34" },
      { label: "Send day", value: "Thursday · 71%" },
      { label: "Sales share", value: "32% of sends" },
      { label: "Average gap", value: "7.6 days" },
    ],
    tour: [0, 3, 13, 16, 17, 27, 33],
  },
  {
    id: "audo",
    name: "Audo Copenhagen",
    brandMark:
      "https://d3k81ch9hvuctc.cloudfront.net/company/WubKek/images/f03357ca-388f-4408-bba3-34d616637772.png",
    cadence: "Monthly · second Tuesday",
    windowStart: "2025-03-01",
    windowEnd: "2025-12-31",
    sends: audoSends,
    annotations: [
      {
        start: "2025-07-09",
        end: "2025-09-08",
        label: "Quiet · 62 days",
        tone: "quiet",
      },
    ],
    insights: [
      { label: "Total sends", value: "9" },
      { label: "Cadence", value: "Monthly" },
      { label: "Sales share", value: "0%" },
      { label: "Average gap", value: "33 days" },
    ],
    tour: [0, 1, 4, 5, 6, 8],
  },
  {
    id: "hubsch",
    name: "Hübsch",
    brandMark:
      "https://content.app-us1.com/cdn-cgi/image/onerror=redirect,width=650,dpr=2,fit=scale-down,format=auto/KZ0mQ/2023/05/04/206ee2d3-1c26-4906-8342-cec02e5dcf71.png",
    cadence: "Bi-weekly · Thursdays",
    windowStart: "2025-02-01",
    windowEnd: "2025-12-31",
    sends: hubSends,
    annotations: [
      {
        start: "2025-07-18",
        end: "2025-08-27",
        label: "Quiet · 41 days",
        tone: "quiet",
      },
      {
        start: "2025-09-11",
        end: "2025-09-11",
        label: "AW25 reveal",
        tone: "shift",
      },
    ],
    insights: [
      { label: "Total sends", value: "18" },
      { label: "Send day", value: "Thursday · 78%" },
      { label: "Sales share", value: "22% of sends" },
      { label: "Average gap", value: "17 days" },
    ],
    tour: [0, 5, 9, 10, 11, 15, 17],
  },
];

/** Quick lookup of category → label used in card chips. */
export const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  launch: "Launch",
  campaign: "Campaign",
  sale: "Sale",
  editorial: "Editorial",
  announcement: "Announcement",
};
