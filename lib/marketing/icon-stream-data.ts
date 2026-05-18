/**
 * Placeholder data for the "Icon Stream" hero on `/`.
 *
 * Two vertical columns of app-icon-style tiles, each with a short
 * made-up newsletter insight that the spotlight cycle reveals one at
 * a time. Real brand logos and real stats will replace this later;
 * for now every tile is a colored placeholder with a 1-3 character
 * glyph, and every stat is invented.
 */

export type IconStreamItem = {
  /** Unique key. Stable across renders so spotlight tracking works. */
  id: string;
  /** Brand-like word, only ever surfaced inside the `stat` string. */
  name: string;
  /** Tile background color. */
  bg: string;
  /** Glyph color. */
  fg: string;
  /**
   * Centred glyph (1–3 chars, or a short lowercase wordmark for the
   * "script" variant). Every tile carries a glyph — there are no blank
   * placeholders.
   */
  glyph: string;
  /**
   * Short newsletter insight in the same voice as the reference
   * screenshot (e.g. "IKEA sends out 12% fewer mails than
   * competitors in same industry"). Roughly 50–90 chars so it wraps
   * to 2–4 lines at the spotlight width.
   */
  stat: string;
};

export const LEFT_COLUMN: IconStreamItem[] = [
  {
    id: "L-solace",
    name: "Solace",
    bg: "#0d4a4e",
    fg: "#e8d9b0",
    glyph: "S",
    stat: "Solace has run the same hero typography across every send this year."
  },
  {
    id: "L-northwind",
    name: "Northwind",
    bg: "#FFD23A",
    fg: "#1f3aa0",
    glyph: "N",
    stat: "Northwind sends out 12% fewer mails than competitors in the same industry."
  },
  {
    id: "L-gisou",
    name: "Marais",
    bg: "#f6efe2",
    fg: "#1a1814",
    glyph: "marais",
    stat: "Marais sends sales mails every month with up to 50% discount."
  },
  {
    id: "L-lumen",
    name: "Lumen",
    bg: "#7c5cff",
    fg: "#ffffff",
    glyph: "L",
    stat: "95% of emails from Lumen are sent in the morning."
  },
  {
    id: "L-aster",
    name: "Aster",
    bg: "#e6e0d4",
    fg: "#2a2723",
    glyph: "Ast",
    stat: "Aster averages 4.2 newsletters per month, mostly on Thursdays."
  },
  {
    id: "L-wisp",
    name: "Wisp",
    bg: "#d6cee8",
    fg: "#2b1f54",
    glyph: "W",
    stat: "Wisp opens every promo with a single line of body copy, never more."
  },
  {
    id: "L-fjord",
    name: "Fjord",
    bg: "#0e3b4a",
    fg: "#cfe9f0",
    glyph: "Fj",
    stat: "Fjord switched ESP from Mailchimp to Klaviyo earlier this year."
  },
  {
    id: "L-loop",
    name: "Loop",
    bg: "#ff5a3c",
    fg: "#ffffff",
    glyph: "L",
    stat: "73% of Loop's subject lines start with an emoji."
  },
  {
    id: "L-paloma",
    name: "Paloma",
    bg: "#f3c5c0",
    fg: "#3a1716",
    glyph: "Pa",
    stat: "Paloma's average newsletter is 1.4 screens long on mobile."
  },
  {
    id: "L-glade",
    name: "Glade",
    bg: "#2d4838",
    fg: "#bcd3aa",
    glyph: "G",
    stat: "Glade includes an unsubscribe link in the preheader of every send."
  },
  {
    id: "L-meridian",
    name: "Meridian",
    bg: "#1a1a1d",
    fg: "#ffffff",
    glyph: "M",
    stat: "Meridian sends a recap newsletter every Sunday at 18:00 CET."
  },
  {
    id: "L-savant",
    name: "Savant",
    bg: "#c9d6c3",
    fg: "#1f2a22",
    glyph: "S",
    stat: "Savant's emails use exactly three colors from a fixed palette."
  },
  {
    id: "L-orbit",
    name: "Orbit",
    bg: "#0a2540",
    fg: "#ffd166",
    glyph: "O",
    stat: "Orbit changed its newsletter typeface from Inter to GT America in March."
  },
  {
    id: "L-tellurian",
    name: "Tellurian",
    bg: "#d4b896",
    fg: "#3a2818",
    glyph: "Te",
    stat: "Tellurian sends three sales emails for every editorial newsletter."
  }
];

export const RIGHT_COLUMN: IconStreamItem[] = [
  {
    id: "R-bramble",
    name: "Bramble",
    bg: "#3d2817",
    fg: "#f3e2c4",
    glyph: "Br",
    stat: "Bramble's preheader has read the same five words for nine months."
  },
  {
    id: "R-pandora",
    name: "Pandora",
    bg: "#f4d8d1",
    fg: "#1a1814",
    glyph: "◯",
    stat: "64% of Pandora newsletters contain a GIF."
  },
  {
    id: "R-fermliving",
    name: "Ferm Living",
    bg: "#b8a98f",
    fg: "#1f1b15",
    glyph: "FL",
    stat: "Ferm Living recently switched ESP from APSIS to Klaviyo."
  },
  {
    id: "R-tessera",
    name: "Tessera",
    bg: "#0e1a2b",
    fg: "#f5b1a5",
    glyph: "T",
    stat: "Tessera sends drops on the first Tuesday of every month at 09:00."
  },
  {
    id: "R-arbor",
    name: "Arbor",
    bg: "#5a7f70",
    fg: "#f1efe8",
    glyph: "Ar",
    stat: "Arbor's preheader copy averages 7 words across the last 30 sends."
  },
  {
    id: "R-quart",
    name: "Quart",
    bg: "#f4b48a",
    fg: "#3d1f0e",
    glyph: "Q",
    stat: "Quart sends from a personal-looking name 100% of the time."
  },
  {
    id: "R-cobalt",
    name: "Cobalt",
    bg: "#2848d4",
    fg: "#ffffff",
    glyph: "Co",
    stat: "Cobalt only sends on Tuesdays and Fridays — never on weekends."
  },
  {
    id: "R-mera",
    name: "Mera",
    bg: "#fef3c7",
    fg: "#7a4e0a",
    glyph: "m",
    stat: "Mera's hero image is the same shade of cream in 9 out of 10 sends."
  },
  {
    id: "R-vellum",
    name: "Vellum",
    bg: "#e9d8c4",
    fg: "#3a2a18",
    glyph: "Ve",
    stat: "Vellum's average subject line is 38 characters — twice the category median."
  },
  {
    id: "R-vox",
    name: "Vox",
    bg: "#3a1d63",
    fg: "#d8c4ee",
    glyph: "V",
    stat: "Vox newsletters average 980px tall — twice the category median."
  },
  {
    id: "R-kindling",
    name: "Kindling",
    bg: "#c0532b",
    fg: "#fff3e3",
    glyph: "K",
    stat: "Kindling sends a free-shipping promo on the last Thursday of every month."
  },
  {
    id: "R-noor",
    name: "Noor",
    bg: "#101010",
    fg: "#e9d27a",
    glyph: "N",
    stat: "Noor's newsletters are 88% image, 12% text — well above the industry mean."
  },
  {
    id: "R-isle",
    name: "Isle",
    bg: "#a7c4cf",
    fg: "#0d1c22",
    glyph: "Is",
    stat: "Isle's CTAs read 'Discover' in 81% of sends across the last year."
  },
  {
    id: "R-hush",
    name: "Hush",
    bg: "#fae08a",
    fg: "#3d2a0a",
    glyph: "H",
    stat: "Hush always centers its hero image, with the body copy below it."
  }
];
