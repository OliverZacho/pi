/**
 * Documentation content registry.
 *
 * Single source of truth for the `/docs` site (branded "Learn"): it powers the
 * left-hand sidebar, the article pages (`/docs/[slug]`), and the right-hand
 * "On this page" table of contents.
 *
 * The library is organised around what Pirol can actually show you. The
 * "Benchmarks" articles quote LIVE aggregates from the captured-email archive —
 * any paragraph may contain `{{token}}` placeholders and any section may carry a
 * `figure`, both resolved at render time by `app/docs/[slug]/page.tsx` from
 * `lib/docs/insights.ts`. Articles flagged `insight` load that dataset; the
 * tokens/figures fall back to neutral prose if the data is briefly unavailable.
 *
 * Every article here is fully written. The `draft` flag remains supported — a
 * draft article is badged in the UI and hidden from the sitemap/llms.txt — but
 * nothing is currently flagged.
 */

/** Which archive dataset an article needs (see `lib/docs/insights.ts`). */
export type DocInsightKey =
  | "esp"
  | "sendTime"
  | "cadence"
  | "discount"
  | "contentMix";

/** A server-rendered, static figure embedded in a section. */
export type DocFigure = {
  /** The visual treatment (see `components/docs/InsightFigure`). */
  kind: "statStrip" | "shareBar" | "heatStrip" | "rangeBars" | "pairedBars";
  /** Selects which prepared figure to render (built by the page from the insight). */
  dataKey: string;
};

/** A question/answer pair — rendered as an FAQ block and as FAQPage JSON-LD. */
export type DocFaq = { question: string; answer: string };

export type DocSection = {
  /** Stable id used for the in-page anchor and the TOC link. */
  id: string;
  heading: string;
  /** One or more paragraphs of body copy; may contain `{{token}}` placeholders. */
  body: string[];
  /** Optional static figure rendered after the paragraphs. */
  figure?: DocFigure;
  /** Optional call-to-action link rendered at the end of the section. */
  cta?: { label: string; href: string };
};

export type DocArticle = {
  slug: string;
  title: string;
  /** Short lead paragraph shown under the title and used as the meta description. */
  description: string;
  /** Roughly how long the finished article will take to read. */
  readingTime: string;
  /** Set while the article is still seed copy so we can badge it as a draft. */
  draft?: boolean;
  /** Names the live dataset to load; enables `{{token}}` + `figure` resolution. */
  insight?: DocInsightKey;
  sections: DocSection[];
  /** Optional FAQ block; answers may use `{{token}}` placeholders too. */
  faqs?: DocFaq[];
};

export type DocCategory = {
  id: string;
  title: string;
  /** Short blurb shown on the docs landing page. */
  blurb: string;
  articles: DocArticle[];
};

export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: "benchmarks",
    title: "Benchmarks",
    blurb:
      "What the brands we track actually do — live numbers from the archive, updated as more email lands.",
    articles: [
      {
        slug: "which-esp-do-brands-use",
        title: "Which ESP do brands actually use?",
        description:
          "There is no single most-used email platform — the answer turns on industry and region. Here is what the brands Pirol tracks actually send with, recomputed continuously from their live email.",
        readingTime: "5 min read",
        insight: "esp",
        sections: [
          {
            id: "the-real-answer",
            heading: "Is there a single most-used ESP?",
            body: [
              "The honest answer is no — and any guide that hands you one name is selling a simplification. The email service provider that dominates one industry is a rounding error in the next, and a platform built for a venture-backed retailer would strain under a museum's newsletter, or the other way around. Market share only becomes meaningful once you ask it where, and for whom.",
              "What is genuinely useful, then, is not a universal champion but a map: which platforms have earned real adoption, where they concentrate, and what that concentration signals about the tool you should be shortlisting. Every figure below is drawn from the brands Pirol actively tracks, and each one refreshes as new email is captured — so you are reading a living picture rather than a survey frozen on the day it was published."
            ]
          },
          {
            id: "what-brands-use",
            heading: "Which email platforms do brands use most?",
            body: [
              "Pirol identifies the sending platform behind every captured email — reading the authentication records, the click-tracking and unsubscribe domains, and the structural fingerprints each provider leaves in its markup. Aggregated across the archive, an unambiguous hierarchy emerges.",
              "{{topEsp}} is the most-used platform, serving as the primary ESP for {{topEspShare}} of the {{espBrandCount}} brands where the provider can be identified with confidence; {{secondEsp}} follows at {{secondEspShare}}. Between them and the next contender, the three leading platforms account for {{topThreeShare}} of all tracked brands — a concentration that tells you the market has consolidated around a small set of serious players rather than fragmenting across dozens."
            ],
            figure: { kind: "shareBar", dataKey: "espShare" }
          },
          {
            id: "by-industry",
            heading: "Does the most-used ESP change by industry?",
            body: [
              "Decisively. The aggregate ranking flattens a landscape that is, on closer inspection, sharply segmented — each sector gravitating toward the platform whose economics and feature set match its own. Read the same brands by industry and the leaders rearrange accordingly.",
              "Among tracked brands, the pattern runs {{espByIndustry}} The practical lesson for anyone weighing a platform is to disregard the global leaderboard and study the column that actually contains your competitors.",
              "The bars below show not just who leads each industry, but how decisively — a tall bar means a category has effectively standardised, while a short one signals a market still in play."
            ],
            figure: { kind: "rangeBars", dataKey: "espIndustries" }
          },
          {
            id: "why-it-matters",
            heading: "Why does it matter which ESP your competitors use?",
            body: [
              "A platform choice is a strategic tell. It hints at how mature a competitor's automation is, how finely they segment, and how quickly they can move from idea to send. Where a whole category has converged on one ESP, that is a de facto standard you ignore at your peril; where it remains fragmented, there is room to win on execution alone.",
              "You do not have to infer any of this from a static chart. Pirol surfaces each company's detected platform alongside the rest of its sending behaviour, so you can line up the brands you compete with and see, at a glance, whether your market has settled on a standard or is still genuinely up for grabs."
            ],
            cta: { label: "Compare your competitors' platforms →", href: "/features/comparisons" }
          }
        ],
        faqs: [
          {
            question: "What is an ESP (email service provider)?",
            answer:
              "An email service provider is the platform a company uses to store its subscriber list, build and send campaigns at scale, automate lifecycle messages, and measure the results. Klaviyo, Mailchimp, Braze and Salesforce Marketing Cloud are widely used examples."
          },
          {
            question: "What is the most popular ESP right now?",
            answer:
              "Across the brands Pirol tracks, {{topEsp}} is the most-used primary platform, ahead of {{secondEsp}}. The ranking is recomputed continuously, and it changes markedly once you filter by industry — the leader in one sector is rarely the leader in another."
          },
          {
            question: "How does Pirol detect which ESP a brand uses?",
            answer:
              "It analyses the signals every platform leaves in the mail it sends — authentication records, link and unsubscribe domains, and recurring structural patterns in the HTML — then attributes each brand to the provider behind the majority of its sends."
          }
        ]
      },
      {
        slug: "best-time-to-send-email",
        title: "The best time to send marketing email",
        description:
          "Best-send-time studies contradict one another because each reflects a different list. Here is when the brands Pirol tracks actually reach the inbox — and how to find the window your competitors leave open.",
        readingTime: "6 min read",
        insight: "sendTime",
        sections: [
          {
            id: "is-there-a-best-time",
            heading: "Is there a universal best time to send email?",
            body: [
              "No — and the reason is structural rather than a matter of insufficient data. Every widely cited \"best time to send\" study reports the average behaviour of a single provider's customer base, which is precisely why their conclusions so rarely survive contact with one another. An apparel brand reaching Copenhagen at breakfast and a software newsletter landing in San Francisco at lunch cannot share one optimal hour, and no amount of averaging will reconcile audiences that live in different time zones, industries and states of mind.",
              "The figure worth knowing is not a magic hour but the rhythm of your particular market — when the brands competing for the same attention actually arrive in the inbox. Once that rhythm is visible, timing stops being superstition and becomes a question of positioning."
            ]
          },
          {
            id: "when-brands-send",
            heading: "When do brands actually send their email?",
            body: [
              "Pirol timestamps every captured send and buckets it by hour of the day, in the platform's local time zone. Plotted across a full day, the inbox reveals an unmistakable pulse.",
              "The single busiest hour is {{peakHourLabel}}, which alone accounts for {{peakShare}} of all sends. Widen the lens and the morning window (6–11am) carries {{morningShare}} of total volume against {{eveningShare}} in the evening (5–9pm) — confirmation that, for the overwhelming majority of brands, the working day still frames the send calendar."
            ],
            figure: { kind: "heatStrip", dataKey: "sendHeat" }
          },
          {
            id: "by-daypart",
            heading: "Morning, afternoon, or evening?",
            body: [
              "Bucketed into dayparts, the pattern hardens into something you can plan around — and it splits further by sector, since each industry inherits the daily rhythm of the audience it serves.",
              "Timing clusters by category: peaks fall {{sendTimeByIndustry}} Knowing where your own sector sits is the difference between arriving with the crowd and arriving deliberately."
            ],
            figure: { kind: "statStrip", dataKey: "sendTimeStats" }
          },
          {
            id: "find-the-gap",
            heading: "How do you find the best send time for your brand?",
            body: [
              "Begin by inverting the question. If everyone crowds the same hours, those hours are not opportunities — they are congestion, the inbox equivalent of rush hour. The most valuable slot is frequently the quiet one your competitors have collectively abandoned: among tracked brands, volume thins markedly around {{quietHourLabel}}, when a well-timed message meets far less resistance for the same attention.",
              "None of this need be guesswork. Place your competitors side by side in Pirol and their individual send-hour patterns appear together, making both the crowded windows and the gaps between them obvious. From there you are no longer copying an average — you are choosing the moment the inbox belongs to you."
            ],
            cta: { label: "See when your competitors send →", href: "/features/comparisons" }
          }
        ],
        faqs: [
          {
            question: "What is the best time to send marketing emails?",
            answer:
              "There is no single best time; it depends on your audience and market. Across the brands Pirol tracks, the busiest hour is {{peakHourLabel}} and most volume lands in the morning — which often makes a quieter, less contested window the smarter choice for standing out."
          },
          {
            question: "Should I send email in the morning or the evening?",
            answer:
              "Among tracked brands, {{morningShare}} of sends land in the morning versus {{eveningShare}} in the evening. The morning is more competitive precisely because it is more crowded, so the right answer depends on whether you are optimising for reach or for relative quiet."
          },
          {
            question: "How can I see when my competitors send?",
            answer:
              "Pirol records the send time of every captured email and lets you compare brands side by side, so you can map exactly which hours your competitors occupy and which they leave open."
          }
        ]
      },
      {
        slug: "how-often-to-email",
        title: "How often should you email your list?",
        description:
          "Email too little and you fade; too much and you exhaust the list. Here is the weekly cadence the brands Pirol tracks actually keep — overall, and by industry.",
        readingTime: "5 min read",
        insight: "cadence",
        sections: [
          {
            id: "how-often-is-too-often",
            heading: "How often is too often to email?",
            body: [
              "There is no fixed ceiling, only a moving trade-off. Send too rarely and you forfeit mindshare and revenue to the brands that stay present; send too often and unsubscribes, spam complaints and quiet disengagement erode the very list you are working to monetise. The discipline lies in finding the highest frequency your audience will tolerate before fatigue sets in — a threshold that sits in a different place for every brand and every list.",
              "A benchmark cannot draw that line for you, but it can tell you where comparable brands have drawn theirs, which is the most useful reference point you have before the testing begins."
            ]
          },
          {
            id: "emails-per-week",
            heading: "How many emails do brands send per week?",
            body: [
              "Pirol measures each brand's cadence from its complete capture history, normalising for how long the brand has been tracked so that newcomers and veterans are compared on equal terms. The central tendency turns out to be steadier than the loudest voices in the industry would have you believe.",
              "Across the {{brandCount}} brands with enough history to measure reliably, the typical brand sends {{avgPerWeek}} emails per week. The spread, however, is wide: {{busiestIndustry}} brands push hardest at roughly {{busiestPerWeek}} a week, while {{calmestIndustry}} brands hold closer to {{calmestPerWeek}}."
            ],
            figure: { kind: "statStrip", dataKey: "cadenceStats" }
          },
          {
            id: "by-industry",
            heading: "What is a normal email frequency for my industry?",
            body: [
              "Your sector sets the gravity. A cadence that feels relentless in one category is unremarkable in another, so the average worth anchoring to is your industry's, not the market's as a whole.",
              "The chart below ranks tracked industries by weekly cadence, with the line marking the all-brand average — a quick read on whether your category runs hot or cool before you commit to a pace of your own."
            ],
            figure: { kind: "rangeBars", dataKey: "cadenceIndustries" }
          },
          {
            id: "set-your-cadence",
            heading: "How should you set your own sending cadence?",
            body: [
              "Treat the benchmark as a floor for ambition and a ceiling for caution, then let real behaviour refine it. The brands genuinely competing for your subscribers' attention are the truest guide of all — particularly in the way their cadence swells in the run-up to a sale and contracts through the quiet weeks between.",
              "Follow those brands in Pirol and their weekly rhythm is laid out for you, ramp-ups and lulls included, so you can pace your own programme against the competitors who matter rather than against an industry-wide mean."
            ],
            cta: { label: "Track competitor cadence →", href: "/features/comparisons" }
          }
        ],
        faqs: [
          {
            question: "How often should a business email its list?",
            answer:
              "Most brands settle into a weekly rhythm rather than a daily one. Across the brands Pirol tracks, the typical brand sends {{avgPerWeek}} emails per week, though the right number depends heavily on your industry and how engaged your list is."
          },
          {
            question: "Can you email your list too much?",
            answer:
              "Yes. Past the point your audience will tolerate, additional sends drive unsubscribes, spam complaints and falling open rates — which can in turn damage deliverability for the emails that matter most. The safe approach is to raise cadence gradually and watch engagement as you go."
          },
          {
            question: "What is a good email frequency by industry?",
            answer:
              "It varies widely. Among tracked brands, {{busiestIndustry}} sends most often at around {{busiestPerWeek}} per week, while {{calmestIndustry}} holds closer to {{calmestPerWeek}} — which is why benchmarking against your own category matters far more than any universal rule."
          }
        ]
      },
      {
        slug: "how-much-brands-discount",
        title: "How much do brands discount — and when?",
        description:
          "Every discount converts today and conditions tomorrow. Here is how often the brands Pirol tracks actually run offers, how deep they cut, and how to read a competitor's promotional rhythm.",
        readingTime: "5 min read",
        insight: "discount",
        sections: [
          {
            id: "good-or-bad",
            heading: "Is discounting good or bad for a brand?",
            body: [
              "Both — which is exactly why it rewards discipline. A discount reliably lifts conversion in the moment, yet every offer also teaches the audience a lesson: that patience is rewarded and full price is for the uninitiated. The brands that protect their margins do not abstain from discounting; they ration it, deploying offers as deliberate moves rather than as a reflex against a soft week.",
              "The question worth asking is therefore comparative. Not whether to discount, but how often and how deeply — measured against the brands you actually compete with."
            ]
          },
          {
            id: "how-often",
            heading: "How often do brands discount?",
            body: [
              "Pirol extracts the offer from every email it captures — the percentage off, the code, the mechanic — and aggregates that habit across the archive.",
              "A typical brand attaches a discount to {{discountShare}} of its sends, at an average depth of {{avgDepth}} off. The deepest cut on record reaches {{maxDepth}}, a useful reminder that the headline promotions you remember are the outliers, not the norm — most discounting is shallower and more routine than it feels from the receiving end of the inbox."
            ],
            figure: { kind: "statStrip", dataKey: "discountStats" }
          },
          {
            id: "by-industry",
            heading: "Which industries discount the most?",
            body: [
              "Promotional intensity is profoundly sector-specific. Some categories live in a near-permanent state of sale; others guard their pricing almost completely and compete on brand instead.",
              "Among tracked brands, {{discountByIndustry}} Set side by side, frequency and depth tell a sharper story than either does alone — a category can discount constantly but shallowly, or rarely but hard, and only the pair reveals which."
            ],
            figure: { kind: "pairedBars", dataKey: "discountIndustries" }
          },
          {
            id: "track-competitors",
            heading: "How can you track a competitor's discounting?",
            body: [
              "A single discounted email is noise; the cadence of offers is signal. Watched over weeks, a competitor's promotions reveal their calendar — the run-ups to peak season, the depth they are willing to reach, and the quiet stretches when they hold the line on price.",
              "In Pirol you can set a rule — say, offers above a given depth within your market — and let it assemble a living board of every qualifying campaign as it lands. The competitor's discount rhythm emerges on its own, ready to read whenever you need it."
            ],
            cta: { label: "Build a live discount board →", href: "/features/collections" }
          }
        ],
        faqs: [
          {
            question: "How often should you offer discounts?",
            answer:
              "Less often than instinct suggests. Across the brands Pirol tracks, a typical brand discounts {{discountShare}} of its sends; treating offers as occasional, deliberate events rather than a default protects both your margin and the perceived value of full price."
          },
          {
            question: "What is a typical discount percentage?",
            answer:
              "Among tracked brands the average offer is {{avgDepth}} off, with the deepest on record reaching {{maxDepth}}. Everyday discounting tends to be modest; the very deep cuts are reserved for peak moments such as seasonal sales."
          },
          {
            question: "How do I monitor my competitors' promotions?",
            answer:
              "Pirol reads the offer out of every captured email, so you can build an automatic collection of competitors' discounts and watch their promotional calendar — both frequency and depth — take shape over time."
          }
        ]
      },
      {
        slug: "content-mix-benchmarks",
        title: "What competitors actually put in the inbox",
        description:
          "Sales, product showcases, launches, editorial — the mix of campaign types a brand sends is its strategy in miniature. Here is what the brands Pirol tracks actually broadcast.",
        readingTime: "5 min read",
        insight: "contentMix",
        sections: [
          {
            id: "why-mix-matters",
            heading: "What does a brand's content mix reveal?",
            body: [
              "A brand's content mix is its strategy made visible. A sender that fills the inbox with markdowns is competing on price and training its audience to wait for the next cut; one that leads with product storytelling and editorial is building desire and defending full price. Neither is wrong, but they are different games — and the proportions give the game away long before any results do.",
              "Reading that mix across many brands turns a vague impression into a benchmark you can position against. The figures here cover broadcast campaigns from the brands Pirol tracks, and deliberately exclude welcome mail — those are triggered lifecycle messages, not the deliberate campaign choices that reveal strategy."
            ]
          },
          {
            id: "the-mix",
            heading: "What types of email do brands send most?",
            body: [
              "Pirol classifies every captured email by intent — sale, product showcase, launch, event, editorial, seasonal, and so on — and aggregates the result across the archive.",
              "Across {{sampleSize}} broadcast campaigns, {{topType}} is the most common type at {{topTypeShare}}, followed by {{secondType}} at {{secondTypeShare}}. Outright sales account for {{saleShare}} of everything brands send — a reminder that, for all the talk of brand-building, a substantial share of the inbox is still working the discount."
            ],
            figure: { kind: "shareBar", dataKey: "contentMix" }
          },
          {
            id: "by-industry",
            heading: "Does the content mix differ by industry?",
            body: [
              "Considerably. Each category inherits the rhythm of how it actually sells, so the leading campaign type shifts from one sector to the next.",
              "Among tracked brands, {{contentByIndustry}} Knowing your own category's default is the first step to deciding where to follow it — and where a different mix could set you apart."
            ]
          },
          {
            id: "use-it",
            heading: "How can you benchmark your own content mix?",
            body: [
              "Begin with a competitor you respect and read the proportions, not the individual sends. If a rival leans almost entirely on sales while you have room to lead with product and story, that contrast is a positioning opportunity rather than a gap to close.",
              "Pirol breaks down the content mix for any brand you open, and lets you set competitors side by side so the differences in strategy surface at a glance — what each one prioritises, and what they quietly never send."
            ],
            cta: { label: "Compare competitors' content mix →", href: "/features/comparisons" }
          }
        ],
        faqs: [
          {
            question: "What is an email content mix?",
            answer:
              "An email content mix is the breakdown of a brand's campaigns by type — what share are sales versus product showcases, launches, editorial, events and so on. It is one of the clearest signals of a brand's overall email strategy."
          },
          {
            question: "What type of email do brands send most?",
            answer:
              "Across the broadcast campaigns Pirol tracks, the most common type is {{topType}} at {{topTypeShare}}, with {{secondType}} close behind. Outright sales make up {{saleShare}} of all campaigns."
          },
          {
            question: "How much of marketing email is discounts?",
            answer:
              "Among the brands Pirol tracks, sale campaigns account for {{saleShare}} of broadcast sends — a large share, though most brands balance it with product, launch and editorial content rather than discounting constantly."
          }
        ]
      }
    ]
  },
  {
    id: "competitive-strategy",
    title: "Competitive strategy",
    blurb: "Turn a feed of competitor email into an actual edge.",
    articles: [
      {
        slug: "competitor-email-teardown",
        title: "How to run a competitor email teardown",
        description:
          "A repeatable method for pulling apart a rival's email programme — cadence, timing, offers, content and design — and converting it into moves you can make this week.",
        readingTime: "8 min read",
        sections: [
          {
            id: "what-is-it",
            heading: "What is a competitor email teardown?",
            body: [
              "A competitor email teardown is a structured analysis of another brand's email programme — not a glance at a single campaign, but a study of the patterns that repeat across dozens of sends. The aim is to reconstruct the strategy behind the inbox: how often they show up, when, what they say, what they offer, and how it all looks.",
              "Done once, it tells you what a competitor is doing. Done regularly, it tells you what they are about to do — because the patterns that govern email programmes change slowly and telegraph their moves."
            ]
          },
          {
            id: "why",
            heading: "Why tear down a competitor's email?",
            body: [
              "Few channels are as candid as email. A competitor will guard its roadmap and its margins, yet every week it voluntarily hands its entire promotional calendar to anyone willing to subscribe. Read carefully, that stream reveals pricing discipline, launch timing, audience priorities and the maturity of the team behind it.",
              "The point is not imitation. It is calibration — knowing where the market sits so you can decide, deliberately, where to match it and where to break from it."
            ]
          },
          {
            id: "what-to-read",
            heading: "What should you look for in a competitor's emails?",
            body: [
              "Five signals carry most of the meaning, and each has an industry benchmark you can measure a competitor against.",
              "First, [how often they send](/learn/how-often-to-email) — cadence reveals how hard a brand is working the channel, and whether it ramps before key moments. Second, [when they send](/learn/best-time-to-send-email) — the hours and days they own, and the windows they leave open. Third, [how often and how deeply they discount](/learn/how-much-brands-discount) — the clearest read on pricing confidence. Fourth, [what they put in the inbox](/learn/content-mix-benchmarks) — the balance of sales, product and story that defines their positioning. Fifth, [which platform they run on](/learn/which-esp-do-brands-use), together with design tells like palette, type and animation — a proxy for how sophisticated their tooling and segmentation are.",
              "Taken together, those five turn a folder of screenshots into a coherent picture of a competitor's whole approach."
            ]
          },
          {
            id: "how-pirol",
            heading: "How do you run a teardown quickly?",
            body: [
              "The slow way is to subscribe, wait, screenshot and tally by hand. The fast way is to let the measurement run continuously in the background.",
              "Open any brand in Pirol and the teardown is already done: send-hour concentration, weekly cadence, discount frequency and depth, content mix, detected platform, palette, fonts and signature calls to action — all computed from its full captured history and kept current as new mail lands."
            ],
            cta: { label: "Tear down a brand in the archive →", href: "/explore" }
          },
          {
            id: "make-it-a-habit",
            heading: "How do you keep a teardown current?",
            body: [
              "A teardown dates the moment you finish it. The durable version is a standing watch: follow the brands that matter and let new campaigns flow into a board you can revisit, so the analysis updates itself instead of expiring.",
              "Set a rule for what you care about — a market, a campaign type, a discount threshold — and Pirol keeps the collection filled automatically, turning a one-off teardown into a living view of the competition."
            ],
            cta: { label: "Build a living competitor board →", href: "/features/collections" }
          }
        ],
        faqs: [
          {
            question: "What is a competitor email teardown?",
            answer:
              "It is a structured analysis of another brand's email programme — its cadence, timing, offers, content mix and design — read across many sends rather than one, to reconstruct the strategy behind the inbox."
          },
          {
            question: "How do you analyse a competitor's emails?",
            answer:
              "Subscribe to their list (or use a tool that already captures it), then look for repeating patterns across five signals: how often they send, when, how much they discount, what types of email they send, and which platform and design choices they use."
          },
          {
            question: "Is it legal to monitor competitors' marketing emails?",
            answer:
              "Yes. Marketing emails are sent to anyone who subscribes, and analysing the campaigns you receive is standard competitive research. Pirol works only with brands' public marketing email, never private or personal data."
          }
        ]
      },
      {
        slug: "find-send-time-gaps",
        title: "Find the gaps: send when your competitors go quiet",
        description:
          "The best send slot is often the one your rivals leave empty. How to map the inbox's crowded hours — and the quiet windows where your email has room to breathe.",
        readingTime: "5 min read",
        insight: "sendTime",
        sections: [
          {
            id: "why-gaps-work",
            heading: "Why send email when competitors are quiet?",
            body: [
              "Attention is a fixed quantity, and the inbox is the most crowded marketplace for it. When a dozen brands pile into the same morning slot, they are not only competing with you — they are competing with one another, and every sender ends up buried in the same pile. Arrive in a quieter window and the identical email commands a larger share of a smaller, more attentive moment.",
              "This is the contrarian half of send-time strategy. The raw question of when brands send is covered in the guide to [the best time to send marketing email](/learn/best-time-to-send-email); here the aim is to turn that distribution to your advantage rather than simply join it."
            ]
          },
          {
            id: "where-is-the-crowd",
            heading: "When is the inbox most crowded?",
            body: [
              "Mapped across the day, send volume is anything but even. The brands Pirol tracks concentrate heavily in daylight hours, with {{morningShare}} of all sends landing in the morning and a pronounced spike at {{peakHourLabel}}.",
              "Every dark cell below is a contested hour; every pale one is comparatively open air."
            ],
            figure: { kind: "heatStrip", dataKey: "sendHeat" }
          },
          {
            id: "the-quiet-windows",
            heading: "Where are the quiet windows?",
            body: [
              "The valleys matter more than the peaks. Among tracked brands, volume thins markedly around {{quietHourLabel}}, when far fewer messages contend for the same inbox — a natural candidate for a send that needs to be seen rather than scrolled past.",
              "Timing also varies by sector, so your competitors' quiet hours may not match the market's: peaks fall {{sendTimeByIndustry}} The opening you want is the one specific to the brands you compete with, not the average across everyone."
            ]
          },
          {
            id: "find-your-gap",
            heading: "How do you find the gap in your own market?",
            body: [
              "Averages only carry you to the doorstep. The decisive move is to overlay the brands you actually compete with and read their collective calendar — the hours they all occupy, and the ones none of them touch.",
              "Set your competitors side by side in Pirol and their send-hour patterns stack into a single view, making both the shared peaks and the open windows impossible to miss. At that point you are not guessing at a quiet hour; you are choosing the one your rivals have left for you."
            ],
            cta: { label: "Map your competitors' timing →", href: "/features/comparisons" }
          }
        ],
        faqs: [
          {
            question: "Is it better to send email when competitors are not?",
            answer:
              "Often, yes. Crowded send windows mean a crowded inbox and more competition for attention. Among the brands Pirol tracks, most volume lands in the morning, so a quieter window can give the same email a larger share of attention — provided it still suits your audience's habits."
          },
          {
            question: "When is the inbox least crowded?",
            answer:
              "Across tracked brands, send volume thins around {{quietHourLabel}}, well away from the {{peakHourLabel}} peak. The least-crowded window for your specific audience depends on your competitors, which is why mapping them directly beats relying on an average."
          },
          {
            question: "How do I find the best send-time gap?",
            answer:
              "Compare the send-hour patterns of the brands you compete with, find the hours they all crowd into, and target a window they leave open. Pirol lets you overlay competitors' timing side by side to surface those gaps."
          }
        ]
      },
      {
        slug: "living-swipe-file",
        title: "Build a swipe file that stays current",
        description:
          "A folder of screenshots is out of date the day you make it. How to build a swipe file that fills itself as your competitors keep sending — and stays useful for years.",
        readingTime: "5 min read",
        sections: [
          {
            id: "what-is-a-swipe-file",
            heading: "What is an email swipe file?",
            body: [
              "A swipe file is a curated reference library of marketing worth studying — the campaigns you return to when you need a subject line that works, a welcome flow worth modelling, or proof of how a competitor handles a launch. For email specifically, it is the collection of sends you keep close because they reward a second look.",
              "Used well, a swipe file shortcuts the blank page and sharpens every brief. The difficulty has never been starting one; it is keeping it alive."
            ]
          },
          {
            id: "why-they-rot",
            heading: "Why do most swipe files go stale?",
            body: [
              "The conventional swipe file is a folder of screenshots, and it begins decaying the moment you close it. Competitors keep sending, seasons turn, and the campaigns you captured harden into a snapshot of one quarter rather than a living record of how brands actually behave. Maintaining it by hand — subscribing, watching, capturing, filing — is precisely the kind of chore that quietly lapses within a fortnight.",
              "A swipe file that depends on constant manual upkeep is a swipe file that will be out of date the next time you genuinely need it."
            ]
          },
          {
            id: "self-updating",
            heading: "How do you build a swipe file that updates itself?",
            body: [
              "The remedy is to define what belongs in the file as a rule, then let the capture happen automatically. Rather than saving emails one at a time, you describe the pattern you care about — a market, a campaign type, a discount threshold — and let every new send that matches flow in on its own.",
              "In Pirol, that is exactly what a collection does. Set a rule — the way brands in your sector [run their sales](/learn/how-much-brands-discount), for instance — and Pirol keeps the board filled as qualifying campaigns land, so the file grows without you lifting a finger."
            ],
            cta: { label: "Build a self-filling collection →", href: "/features/collections" }
          },
          {
            id: "how-to-use",
            heading: "How should you use a swipe file?",
            body: [
              "A living swipe file earns its keep three ways: as a creative prompt when you are stuck, as a record of how rivals operate over time, and as a shared reference the whole team can draw on. Because it stays current, it doubles as a lightweight [competitor teardown](/learn/competitor-email-teardown) that never goes out of date.",
              "The discipline is curation rather than accumulation. A focused board built around a clear theme will be opened and used; a sprawling archive of everything will not."
            ]
          }
        ],
        faqs: [
          {
            question: "What is a swipe file?",
            answer:
              "A swipe file is a curated collection of marketing examples — emails, in this case — kept as a reference for inspiration, for modelling structure, or for documenting how competitors operate."
          },
          {
            question: "How do you keep a swipe file up to date?",
            answer:
              "Define what belongs in it as a rule rather than saving items one by one, and use a tool that captures matching campaigns automatically. In Pirol, a collection with a set rule keeps filling itself as new emails land."
          },
          {
            question: "What should go in an email swipe file?",
            answer:
              "Whatever you will actually reference: strong subject lines, welcome and re-engagement flows, launch sequences, and competitors' sales — ideally organised into focused boards by theme rather than one undifferentiated pile."
          }
        ]
      }
    ]
  },
  {
    id: "choosing-an-esp",
    title: "Choosing an ESP",
    blurb: "Frameworks for picking a platform — grounded in what brands actually run.",
    articles: [
      {
        slug: "which-esp-should-you-choose",
        title: "Which ESP should you choose? A decision framework",
        description:
          "There is no single best email platform — only the best one for your model, list size and ambitions. A framework for narrowing the field, grounded in what comparable brands already run.",
        readingTime: "8 min read",
        insight: "esp",
        sections: [
          {
            id: "no-best-esp",
            heading: "Is there a best ESP?",
            body: [
              "There is no universally best email service provider, and the question is better reframed as which platform is best for you. The right answer depends on what you sell, how you sell it, how large and engaged your list is, and how much automation you genuinely intend to use — variables that move the recommendation far more than any feature scorecard.",
              "What follows is a framework for narrowing the field quickly, followed by the one shortcut most guides ignore: looking at what the brands you compete with have already chosen."
            ]
          },
          {
            id: "criteria",
            heading: "What criteria actually matter when choosing an ESP?",
            body: [
              "Five considerations decide most outcomes. Deliverability and sending infrastructure come first — a platform that cannot reliably reach the inbox makes every other feature moot. Automation depth comes next: how sophisticated the flows, segmentation and triggers can be, and whether you will actually use that depth or pay for it idle.",
              "Then integrations — above all the link to your commerce or product stack, since broken data is the most common reason migrations fail. Pricing model matters as much as headline price: per-contact, per-send and per-seat structures scale very differently as you grow, and the cheapest plan today can become the most expensive at ten times the list. Finally, support and data portability — how quickly you can get help, and how cleanly you could leave if you needed to."
            ]
          },
          {
            id: "by-stage",
            heading: "Which ESP fits your business model?",
            body: [
              "Map the platform to how you operate. High-volume ecommerce tends to be best served by commerce-native tools with deep flow automation; independent newsletters and media favour publishing-first platforms built around subscriptions and audience growth; enterprise lifecycle teams need cross-channel orchestration and the data infrastructure to match.",
              "Smaller and earlier-stage senders are usually better off with an approachable all-rounder than with an enterprise suite they will use a fraction of — capability you cannot operate is a cost, not an asset."
            ]
          },
          {
            id: "start-from-peers",
            heading: "Should you choose the same ESP as your competitors?",
            body: [
              "Not blindly — but their choices are valuable evidence. When a category has converged on one platform, that consolidation usually reflects a genuine fit between the tool and the way that category sells; when it remains fragmented, the decision rests more on your own priorities than on any emerging standard.",
              "Among the brands Pirol tracks, {{topEsp}} is the most-used platform at {{topEspShare}}, though the leader shifts sharply once you filter by industry. Before you commit, it is worth seeing [which ESP brands in your category actually use](/learn/which-esp-do-brands-use) and lining your shortlisted competitors up side by side."
            ],
            cta: { label: "Compare competitors' platforms →", href: "/features/comparisons" }
          }
        ],
        faqs: [
          {
            question: "How do I choose an email service provider?",
            answer:
              "Weigh five things in order: deliverability, automation depth, integration with your commerce or product stack, pricing model as you scale, and support and data portability. Then sanity-check your shortlist against what comparable brands in your industry already run."
          },
          {
            question: "What is the most-used ESP?",
            answer:
              "Across the brands Pirol tracks, {{topEsp}} is the most-used primary platform at {{topEspShare}}. The leader varies considerably by industry, so the most relevant benchmark is your own category rather than the overall ranking."
          },
          {
            question: "Should I pick the same ESP as my competitors?",
            answer:
              "Not automatically, but it is strong evidence. A category that has consolidated on one platform usually signals a real fit; a fragmented one means the decision rests more on your own requirements than on any standard."
          }
        ]
      },
      {
        slug: "comparing-esps",
        title: "Klaviyo vs. Mailchimp vs. Braze: how to compare",
        description:
          "Comparing email platforms on their own marketing pages is a trap. A like-for-like framework you can apply to any providers — plus the trade-offs that never reach the pricing page.",
        readingTime: "7 min read",
        insight: "esp",
        sections: [
          {
            id: "why-hard",
            heading: "Why is comparing ESPs so difficult?",
            body: [
              "Every platform's website is engineered to win its own comparison — foregrounding the features it leads on and quietly omitting the ones it does not. Klaviyo, Mailchimp and Braze are not even built for the same buyer: one for ecommerce, one for small-business breadth, one for enterprise lifecycle. A feature-by-feature face-off will flatter whichever you were already inclined toward.",
              "A fair comparison therefore needs a framework you control, applied identically to every contender. The three names above are the worked example; the method generalises to any shortlist you assemble."
            ]
          },
          {
            id: "matrix",
            heading: "What should an ESP comparison include?",
            body: [
              "Build a matrix whose rows are the things that genuinely differentiate platforms, not the checkboxes every vendor can tick. Deliverability and sending reputation; the depth and flexibility of automation; native integration with your commerce or product data; segmentation power; reporting that ties to revenue rather than opens; and the quality of support at your particular size.",
              "Score each contender on the same rows, weighted by what your programme actually relies on. A platform that wins on capabilities you will never operate has not won anything that matters."
            ]
          },
          {
            id: "hidden-costs",
            heading: "What hidden costs should you watch for?",
            body: [
              "The sticker price is the smallest part of the decision. Pricing models diverge sharply with scale — per-contact, per-send and per-seat structures that look alike at sign-up can be multiples apart at ten times the list — and overage charges, mandatory tiers and annual commitments widen the gap further.",
              "Then there is the cost of leaving. Migration friction, and how cleanly a platform lets you export your data and rebuild your flows elsewhere, are part of the true price — and they are precisely what never appears on a pricing page."
            ]
          },
          {
            id: "real-evidence",
            heading: "How can you use real-world evidence?",
            body: [
              "Marketing claims are one input; observed behaviour is another, and harder to spin. Knowing which platforms comparable brands have actually committed to — and stayed on — is a powerful sanity check against any vendor's pitch.",
              "Among the brands Pirol tracks, {{topEsp}} is the most-used platform at {{topEspShare}}, though the leader shifts by industry — so [the platforms brands in your category run](/learn/which-esp-do-brands-use) is the more telling figure. Better still, see it brand by brand: Pirol detects the ESP behind each company, so you can line up the specific competitors you would want to emulate and compare not just the platforms' promises but the choices real brands have made."
            ],
            cta: { label: "Compare competitors' platforms →", href: "/features/comparisons" }
          }
        ],
        faqs: [
          {
            question: "How do you compare email service providers?",
            answer:
              "Build a comparison matrix of the criteria that genuinely differ — deliverability, automation depth, integrations, segmentation, revenue reporting and support — score each platform identically, and weight by what your programme actually uses. Then cross-check against which platforms comparable brands actually run."
          },
          {
            question: "Klaviyo vs. Mailchimp vs. Braze — which is best?",
            answer:
              "They target different buyers: Klaviyo is built for ecommerce, Mailchimp for small-business breadth, and Braze for enterprise cross-channel lifecycle. The best choice depends on your model and scale rather than any overall ranking."
          },
          {
            question: "What hidden costs do email platforms have?",
            answer:
              "Watch for pricing that scales steeply with contacts or sends, overage charges, mandatory higher tiers, annual lock-ins, and the migration cost of leaving. Over time these often outweigh the headline price."
          }
        ]
      },
      {
        slug: "esp-pricing-explained",
        title: "ESP pricing models explained",
        description:
          "Per-contact, per-send, per-seat, credits — email platforms price in fundamentally different ways. How to compare them like for like, and avoid the bill that balloons as you grow.",
        readingTime: "6 min read",
        sections: [
          {
            id: "why-hard",
            heading: "Why is ESP pricing so hard to compare?",
            body: [
              "Two platforms can advertise near-identical starting prices and then charge wildly different amounts for the same programme a year later, because they meter completely different things. One bills for every contact you store; another for every email you send; a third for seats, or credits, or a bundle of features gated behind a higher tier. Comparing headline prices tells you almost nothing until you translate each model into your own numbers.",
              "Understanding the models is therefore the real skill. Once you can see what a platform actually charges for, the right choice — and the eventual bill — stops being a surprise."
            ]
          },
          {
            id: "models",
            heading: "What are the common ESP pricing models?",
            body: [
              "Most platforms use one of a handful of structures, sometimes in combination. Per-contact pricing charges for the size of your list regardless of how often you email it — simple, but punishing if you hoard inactive subscribers. Per-send or volume pricing charges by the number of emails dispatched, which suits large lists mailed infrequently and penalises high-cadence senders.",
              "Credit or pay-as-you-go models sell blocks of sends to be drawn down over time, favouring irregular senders. Per-seat pricing charges by the number of users, common in enterprise tools where the contact list is priced separately. And almost everyone layers feature tiers on top, reserving automation depth, advanced segmentation or dedicated support for higher plans — so the line you care about may not be the headline price at all."
            ]
          },
          {
            id: "what-drives-cost",
            heading: "What makes the bill grow as you scale?",
            body: [
              "The cost drivers are rarely the ones you watch at sign-up. List growth is the obvious one, but inactive contacts are the silent tax — on a per-contact plan you pay every month for subscribers who never open. Rising cadence compounds the bill on volume-based plans, and the features you adopt as you mature tend to live in the more expensive tiers.",
              "Then come the edges: overage charges when you exceed a plan's ceiling, mandatory upgrades to unlock a single capability, onboarding or migration fees, and annual contracts that lock the rate in before you know your real usage."
            ]
          },
          {
            id: "forecast",
            heading: "How do you forecast your real cost?",
            body: [
              "Model the platform against your projected numbers, not today's. Take your list size and sending cadence twelve to twenty-four months out, apply the platform's actual model — contacts, sends, seats and tier — and include the overage you will realistically incur. Run the same exercise for every contender so the comparison is genuinely like for like.",
              "Pricing is only one row in the wider decision, though. Weigh it alongside the other criteria in the [ESP decision framework](/learn/which-esp-should-you-choose), and when you pit specific providers against each other, follow the method in [how to compare Klaviyo, Mailchimp and Braze](/learn/comparing-esps)."
            ],
            cta: { label: "Use the ESP decision framework →", href: "/learn/which-esp-should-you-choose" }
          }
        ],
        faqs: [
          {
            question: "What are the main email marketing pricing models?",
            answer:
              "The common ones are per-contact (priced by list size), per-send or volume (priced by emails dispatched), credit or pay-as-you-go (blocks of sends), and per-seat (priced by users). Most platforms also gate features behind higher tiers."
          },
          {
            question: "Why does my ESP bill keep increasing?",
            answer:
              "Usually list growth combined with inactive contacts you still pay to store, rising send cadence on volume plans, features that sit in pricier tiers, and overage charges when you exceed a plan's limits."
          },
          {
            question: "How do I avoid overpaying for an ESP?",
            answer:
              "Forecast cost against your projected list and cadence rather than today's, prune inactive contacts, watch for overage and mandatory-tier charges, and compare every platform on the same future numbers before committing — especially before signing an annual contract."
          }
        ]
      }
    ]
  },
  {
    id: "email-craft",
    title: "Email craft",
    blurb: "How marketing emails are actually built, from the preview line down.",
    articles: [
      {
        slug: "preheader-padding-trick",
        title: "Why email previews show &#8199;&#847; (the preheader padding trick)",
        description:
          "Ever seen a string of &#8199;&#847; codes in an email preview? That is preheader padding, an invisible-character trick nearly every major brand uses to control the inbox preview line. Here is how it works, why it exists, and how to use it without it backfiring.",
        readingTime: "6 min read",
        sections: [
          {
            id: "what-is-a-preheader",
            heading: "What is an email preheader?",
            body: [
              "The preheader is the snippet of text an inbox shows after the subject line, the grey line in Gmail, Apple Mail and Outlook that gives a campaign its second sentence. Technically it is nothing special: mailbox providers simply take the first readable text they find in the body of the email and print it next to the subject.",
              "That mechanical behaviour is the whole problem. Left alone, the preview line fills with whatever happens to sit at the top of the message, which is rarely what the sender would choose. \"View this email in your browser\" has sold very few products, yet it has opened millions of campaigns."
            ]
          },
          {
            id: "the-invisible-trick",
            heading: "What is the preheader padding trick?",
            body: [
              "To control the preview, email designers place their chosen teaser in a hidden element at the very top of the HTML, then pad the end of it with dozens or hundreds of invisible characters. The inbox reads the teaser, runs into the wall of invisible padding, and never reaches the body text behind it. The sender gets a preview line that says exactly what they wrote and nothing more.",
              "The padding itself is a repeating pair of obscure Unicode characters, most often written as the HTML entities &#8199; and &#847;. The first is a figure space, a blank exactly as wide as a digit. The second is a combining grapheme joiner, a character with no width and no appearance at all. Alternated a few hundred times they form a string that renders as pure nothing, yet counts as real text to the software deciding what to show. Older templates use zero-width non-joiners or plain non-breaking spaces for the same purpose.",
              "This is not a fringe hack. It ships in the default templates of most major email platforms, which is why, once you know to look for it, you find it in the source of nearly every marketing email in your inbox."
            ]
          },
          {
            id: "why-brands-do-it",
            heading: "Why do brands pad their preview text?",
            body: [
              "Because the preview line is prime real estate, and without padding the sender does not own it. The subject and preheader together are the entire pitch a subscriber sees before deciding whether to open, and studies of open behaviour consistently rank the preview line just behind the sender name and subject in influence.",
              "Padding solves a specific failure: a short teaser followed by leaked body text. Write a crisp six-word preheader without padding and the inbox will happily append the navigation links, the \"shop now\" button text, or the legal footer to fill the space. The invisible characters act as a buffer that keeps the line clean, so a deliberate ellipsis or elegant silence follows the teaser instead of \"Unsubscribe | View in browser\".",
              "Read competitively, a padded preheader is also a small tell of operational maturity. Brands running serious programmes on serious platforms pad by default; a preview line that bleeds raw body text usually signals a hand-built template or a team not yet sweating the details. It is one of the quieter signals worth noting in a [competitor email teardown](/learn/competitor-email-teardown)."
            ]
          },
          {
            id: "how-to-do-it",
            heading: "How do you pad a preheader properly?",
            body: [
              "The standard implementation is a single hidden element placed immediately after the opening body tag, before any visible content. It contains your teaser sentence followed by the repeating invisible pair, and it is hidden with the belt-and-braces stack email clients respect: display none, zero font size, zero line height, zero max-height, and mso-hide for Outlook.",
              "Keep the visible part of the teaser to roughly 40 to 90 characters. Inboxes truncate at different lengths, mobile clients most aggressively, so the working rule is to front-load the message and let the padding protect whatever space remains. And write the teaser as a continuation of the subject rather than a repeat of it; the two are read as one line, and the strongest pairs hand off mid-thought.",
              "If you use a mainstream email platform, check before you build: most inject the hidden preheader and its padding automatically from the preview-text field in the campaign editor, and adding your own on top can produce a doubled or garbled preview."
            ]
          },
          {
            id: "when-it-shows",
            heading: "When does the trick become visible?",
            body: [
              "The padding is only invisible when everything downstream decodes it correctly. Forward an email through certain clients, view one as plain text, or run it through a tool that reads the raw HTML without converting entities, and the curtain slips: the preview fills with literal &#8199;&#847; codes, the entity notation printed as text instead of rendered as invisible characters. If a preview is cut mid-entity you get a dangling fragment like &#8, which is the giveaway that a string of padding was truncated rather than written.",
              "So if you have ever wondered whether a string of &#8199;&#847; in a preview meant an email was broken, it did not. The email was built exactly to spec; the software displaying it simply showed the machinery instead of the effect.",
              "There is one genuine cost to weigh. Some screen readers announce what sighted users never see, reading out long runs of padding characters or the hidden preheader twice. Keeping the padding modest, a few hundred characters rather than thousands, and keeping the teaser meaningful limits the annoyance for subscribers listening rather than looking."
            ]
          },
          {
            id: "see-it-at-scale",
            heading: "How can you study competitors' preheaders?",
            body: [
              "Subject and preheader are a craft you improve by studying volume, and your own inbox is a thin sample. The faster route is an archive: Pirol captures the subject line and the real preheader of every email it tracks, decoded and cleaned, so you can read how the brands in your market actually use the preview line, campaign after campaign.",
              "Open any brand and scan its recent sends as a list: which teasers continue the subject, which repeat it, which waste the line entirely. It is the quickest available education in writing preview text that earns the open."
            ],
            cta: { label: "Browse real subject and preview lines →", href: "/explore" }
          }
        ],
        faqs: [
          {
            question: "Why does an email preview show &#8199;&#847;?",
            answer:
              "Those are HTML entity codes for invisible padding characters, a figure space and a combining grapheme joiner, that senders repeat after their preview text to stop inbox previews from pulling in body text. When software displays the raw codes instead of decoding them, the normally invisible padding becomes visible. The email is not broken; the trick is simply showing."
          },
          {
            question: "What characters are used to pad a preheader?",
            answer:
              "Most templates alternate a figure space (U+2007, written &#8199;) with a combining grapheme joiner (U+034F, written &#847;). Older templates use zero-width non-joiners or non-breaking spaces. All render as nothing while still counting as text to the inbox preview."
          },
          {
            question: "How long should preheader text be?",
            answer:
              "Aim for roughly 40 to 90 characters of visible teaser, front-loaded so the message survives aggressive mobile truncation, followed by invisible padding to keep body text out of the remainder of the line."
          },
          {
            question: "Do I need to add preheader padding myself?",
            answer:
              "Usually not. Most major email platforms add the hidden preheader element and its padding automatically when you fill in the preview-text field. Only hand-built templates need the technique implemented manually."
          }
        ]
      }
    ]
  },
  {
    id: "deliverability",
    title: "Deliverability & Compliance",
    blurb: "Stay out of the spam folder and on the right side of the law.",
    articles: [
      {
        slug: "avoiding-the-spam-folder",
        title: "Avoiding the spam folder: a deliverability checklist",
        description:
          "Reaching the inbox is earned, not guaranteed. A practical checklist covering authentication, list hygiene, content and the engagement signals mailbox providers actually weigh.",
        readingTime: "7 min read",
        sections: [
          {
            id: "why-spam",
            heading: "Why do emails land in the spam folder?",
            body: [
              "Mailbox providers like Gmail and Outlook decide where a message belongs in milliseconds, and they weigh several things at once: whether the email is authenticated and genuinely from who it claims, how recipients have engaged with your previous sends, the reputation attached to your sending domain and IP, and signals in the content itself. No single factor decides it; a strong score in one area can be undone by a weakness in another.",
              "The encouraging part is that almost everything on that list is within your control. Deliverability is less a dark art than a discipline — a handful of habits applied consistently."
            ]
          },
          {
            id: "authentication",
            heading: "How do you authenticate your email?",
            body: [
              "Authentication is the non-negotiable foundation. SPF, DKIM and DMARC are the three DNS records that prove an email truly originates from your domain, and bulk-sender requirements at Gmail and Yahoo now make them effectively mandatory rather than optional.",
              "Set all three, align them to the domain your recipients see, and verify them before you scale sending. The mechanics are covered in full in [SPF, DKIM and DMARC explained](/learn/spf-dkim-dmarc)."
            ]
          },
          {
            id: "list-hygiene",
            heading: "How do you keep your list healthy?",
            body: [
              "Reputation is built on engagement, and engagement starts with who is on the list. Collect addresses with explicit permission — ideally confirmed opt-in — and never buy or scrape them. Remove hard bounces promptly, suppress repeated soft bounces, and sunset subscribers who have not engaged in months rather than emailing into silence.",
              "A smaller list of people who open and click will reach the inbox far more reliably than a large one padded with dead addresses, because mailbox providers read sustained non-engagement as a sign your mail is unwanted."
            ]
          },
          {
            id: "content-and-habits",
            heading: "What content and sending habits help?",
            body: [
              "Send from a real, monitored address with a genuine reply-to, keep a consistent sending volume rather than erratic spikes, and warm up any new domain or IP gradually instead of blasting it from cold. Make unsubscribing effortless — a visible link and, for bulk senders, one-click list-unsubscribe — because a quick opt-out is far better for your reputation than a spam complaint.",
              "In the content itself, avoid the patterns filters distrust: all-caps or deceptive subject lines, a single giant image with no text, link shorteners, and shouting punctuation. Write as you would to a customer who chose to hear from you, because that is precisely who you are trying to reach."
            ]
          },
          {
            id: "checklist",
            heading: "The pre-send checklist",
            body: [
              "Before every campaign, run the same quick pass: SPF, DKIM and DMARC pass and are aligned; the list is permission-based and recently cleaned; bounces and unsubscribes from the last send are processed; the from-name and reply-to are real; the subject line is honest; the email has a healthy text-to-image balance and a clear unsubscribe link; and the volume is in line with your normal cadence.",
              "None of these guarantees the inbox on its own. Together, run consistently, they are what separates senders who reach it from those who quietly do not."
            ]
          }
        ],
        faqs: [
          {
            question: "Why are my emails going to spam?",
            answer:
              "Usually one of four things: missing or misaligned authentication (SPF, DKIM, DMARC), poor list hygiene and low engagement, a weak sending-domain reputation, or content patterns filters distrust. Deliverability is the combined result of all four."
          },
          {
            question: "How do I stop emails landing in spam?",
            answer:
              "Authenticate with SPF, DKIM and DMARC; email only people who opted in and remove inactive or bouncing addresses; keep a consistent sending volume; make unsubscribing easy; and avoid deceptive subject lines and image-only emails."
          },
          {
            question: "Does list cleaning improve deliverability?",
            answer:
              "Yes. Removing inactive subscribers and bounced addresses raises your engagement rates, which mailbox providers read as a signal that your mail is wanted — improving inbox placement for everyone who remains on the list."
          }
        ]
      },
      {
        slug: "spf-dkim-dmarc",
        title: "SPF, DKIM, and DMARC explained",
        description:
          "The three DNS records that prove an email is genuinely from you. What each one does, how they work together, and how to roll them out without breaking your sending.",
        readingTime: "8 min read",
        sections: [
          {
            id: "what-are-they",
            heading: "What are SPF, DKIM and DMARC?",
            body: [
              "SPF, DKIM and DMARC are three DNS records that together let a receiving mail server verify that an email really came from the domain it claims — and decide what to do if it did not. They are email's answer to forgery: without them, anyone can put your domain in the from field, which is exactly how phishing and spoofing work.",
              "They are also no longer optional. Since 2024, Gmail and Yahoo require bulk senders to authenticate with all three, so any serious sending programme needs them in place. Each plays a distinct role, and the protection comes from using them in concert."
            ]
          },
          {
            id: "spf",
            heading: "What is SPF?",
            body: [
              "SPF — Sender Policy Framework — is a DNS TXT record that lists which servers are authorised to send mail on behalf of your domain. When a message arrives, the receiver checks whether the sending server appears on that list; if not, the message fails SPF.",
              "The main pitfall is SPF's ten-lookup limit: chaining too many third-party services into one record breaks it silently. Keep the record lean, list every legitimate sender (your ESP, your transactional provider, your own servers), and audit it whenever you add a new tool."
            ]
          },
          {
            id: "dkim",
            heading: "What is DKIM?",
            body: [
              "DKIM — DomainKeys Identified Mail — adds a cryptographic signature to every message. Your sending platform signs each email with a private key, and the matching public key is published in your DNS; the receiver uses it to confirm the message was genuinely signed by your domain and was not altered in transit.",
              "Most ESPs generate the keys and hand you a DNS record to publish. The good practice is to rotate keys periodically and to use a strong key length, so a signature can never be quietly forged or replayed."
            ]
          },
          {
            id: "dmarc",
            heading: "What is DMARC?",
            body: [
              "DMARC — Domain-based Message Authentication, Reporting and Conformance — ties the other two together. It tells receivers what to do when a message fails authentication, and it requires alignment: the domain SPF and DKIM validate must match the domain your recipients actually see in the from field.",
              "A DMARC policy has three settings — p=none (monitor only), p=quarantine (send failures to spam) and p=reject (block them outright). The standard rollout is to start in monitor-only mode with reporting switched on, read the aggregate reports to confirm your legitimate mail passes, then tighten to quarantine and finally reject once you are confident nothing breaks."
            ]
          },
          {
            id: "together",
            heading: "How do SPF, DKIM and DMARC work together?",
            body: [
              "Think of them as a chain: SPF vouches for the sending server, DKIM proves the message is intact and genuinely signed, and DMARC sets the policy and demands that both align with your visible domain. A message that satisfies all three is one a receiver can trust — and one far more likely to reach the inbox.",
              "Authentication is the foundation of deliverability, but only the foundation. Once it is solid, the rest of the picture — list hygiene, engagement and sending habits — is covered in the [deliverability checklist](/learn/avoiding-the-spam-folder)."
            ]
          }
        ],
        faqs: [
          {
            question: "What is the difference between SPF, DKIM and DMARC?",
            answer:
              "SPF lists which servers may send for your domain; DKIM cryptographically signs each message to prove it is authentic and unaltered; DMARC sets the policy for what happens when authentication fails and requires the results to align with your visible from domain."
          },
          {
            question: "Do I need all three to send marketing email?",
            answer:
              "Effectively yes. Since 2024, Gmail and Yahoo require bulk senders to use SPF, DKIM and DMARC, and they work as a system — each closes a gap the others leave open."
          },
          {
            question: "What DMARC policy should I start with?",
            answer:
              "Begin with p=none and reporting enabled so you can confirm your legitimate mail passes without affecting delivery, then move to p=quarantine and finally p=reject once the reports show everything authenticates correctly."
          }
        ]
      },
      {
        slug: "gdpr-and-can-spam",
        title: "GDPR and CAN-SPAM: staying compliant",
        description:
          "The EU and US regulate marketing email in very different ways. A plain-English overview of the consent, disclosure and unsubscribe rules — and how to satisfy both.",
        readingTime: "7 min read",
        sections: [
          {
            id: "overview",
            heading: "What do GDPR and CAN-SPAM require?",
            body: [
              "GDPR and CAN-SPAM both govern marketing email, but they start from opposite premises. The EU's GDPR is consent-first: in most cases you may only email people who have actively agreed to hear from you, and you must be able to prove it. The US CAN-SPAM Act is opt-out: you may email without prior consent, provided you are honest about who you are and you stop the moment someone asks.",
              "If you email across borders — as almost every brand now does — you are bound by the rules of wherever your recipients are, not where you are based. The practical answer is to build for the stricter standard and apply the lighter one only where it genuinely fits. What follows is an overview for orientation, not legal advice; for anything consequential, consult a qualified professional."
            ]
          },
          {
            id: "gdpr-consent",
            heading: "What counts as valid consent under GDPR?",
            body: [
              "GDPR sets a high bar for consent: it must be freely given, specific, informed and unambiguous, captured through a clear affirmative action rather than a pre-ticked box or a buried clause. In practice that means an explicit opt-in for marketing, separate from other terms, with plain language about what people are signing up for.",
              "You also have to keep records of when and how each subscriber consented, give them an easy route to withdraw it, and honour data-subject rights such as access and erasure. Consent is not forever, either — a list that has sat unused for years cannot safely be assumed to still hold valid permission."
            ]
          },
          {
            id: "can-spam",
            heading: "What does CAN-SPAM require?",
            body: [
              "CAN-SPAM is lighter on consent but strict on conduct. Your headers and from-line must be accurate, your subject line must not deceive, and the message must be identifiable as an advertisement where that is not already obvious. Every email must include a valid physical postal address.",
              "Crucially, every email must offer a clear way to opt out, and you must honour unsubscribe requests promptly — within ten business days — and then keep that address suppressed. You remain responsible even when a third party sends on your behalf, so outsourcing the send does not outsource the liability."
            ]
          },
          {
            id: "in-practice",
            heading: "How do you stay compliant in practice?",
            body: [
              "A handful of habits cover most of both regimes at once. Collect marketing consent explicitly and log it; default to opt-in for EU contacts and apply opt-out only where US rules genuinely apply. Give every email a visible, working unsubscribe link, process opt-outs quickly, and never reuse a suppressed address. Include your physical address, keep your sender identity honest, and offer a preference centre so people can dial frequency down instead of leaving entirely.",
              "These overlap neatly with good deliverability: prompt unsubscribes and permission-based lists keep you both lawful and welcome in the inbox, as covered in the [deliverability checklist](/learn/avoiding-the-spam-folder)."
            ]
          }
        ],
        faqs: [
          {
            question: "What is the difference between GDPR and CAN-SPAM?",
            answer:
              "GDPR (EU) is consent-first: you generally need explicit, provable opt-in before emailing. CAN-SPAM (US) is opt-out: you may email without prior consent but must be honest, include a physical address, and stop promptly when asked. Which applies depends on where your recipients are."
          },
          {
            question: "Do I need consent to send marketing emails?",
            answer:
              "In the EU and many other regions, yes — GDPR requires explicit, recorded opt-in for marketing. Under US CAN-SPAM you can email without prior consent, provided you are truthful and honour unsubscribe requests. If you email both audiences, the safest approach is to build for consent."
          },
          {
            question: "How quickly must I honour an unsubscribe request?",
            answer:
              "Under CAN-SPAM you must honour opt-outs within ten business days and keep the address suppressed thereafter. Under GDPR withdrawal of consent should be as easy as giving it and acted on without undue delay. In practice, processing unsubscribes immediately satisfies both."
          }
        ]
      }
    ]
  }
];

/** Flat lookup of every article by slug, built once at module load. */
const ARTICLES_BY_SLUG = new Map<string, { article: DocArticle; category: DocCategory }>();
for (const category of DOC_CATEGORIES) {
  for (const article of category.articles) {
    ARTICLES_BY_SLUG.set(article.slug, { article, category });
  }
}

export function getArticle(slug: string) {
  return ARTICLES_BY_SLUG.get(slug) ?? null;
}

export function getAllArticleSlugs(): string[] {
  return [...ARTICLES_BY_SLUG.keys()];
}
