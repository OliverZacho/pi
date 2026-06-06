/**
 * Documentation content registry.
 *
 * This is the single source of truth for the `/docs` site: it powers the
 * left-hand sidebar, the article pages (`/docs/[slug]`), and the right-hand
 * "On this page" table of contents. Articles are intentionally lightweight
 * placeholders for now — the headlines and section outlines are real, the
 * body copy is seed text we'll flesh out as the SEO/GEO articles are written.
 */

export type DocSection = {
  /** Stable id used for the in-page anchor and the TOC link. */
  id: string;
  heading: string;
  /** One or more paragraphs of body copy. */
  body: string[];
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
  sections: DocSection[];
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
    id: "getting-started",
    title: "Getting Started",
    blurb: "The fundamentals of email marketing platforms, in plain language.",
    articles: [
      {
        slug: "what-is-an-esp",
        title: "What is an ESP (Email Service Provider)?",
        description:
          "An Email Service Provider is the software that stores your audience, builds your campaigns, and gets them delivered to the inbox. Here is what an ESP does and why you need one.",
        readingTime: "6 min read",
        draft: true,
        sections: [
          {
            id: "definition",
            heading: "ESP, defined",
            body: [
              "An Email Service Provider (ESP) is the platform you use to collect subscribers, design emails, send them at scale, and measure what happens next.",
              "Without an ESP you would be limited to sending from a personal inbox — which breaks the moment you try to reach more than a handful of people."
            ]
          },
          {
            id: "what-it-does",
            heading: "What an ESP actually does for you",
            body: [
              "Audience management, campaign building, automation, deliverability infrastructure, and reporting all live under one roof.",
              "Placeholder: expand each capability with a concrete example."
            ]
          },
          {
            id: "do-you-need-one",
            heading: "Do you need an ESP?",
            body: [
              "If you email more than a few dozen people on any kind of schedule, the answer is almost always yes."
            ]
          }
        ]
      },
      {
        slug: "esp-vs-marketing-automation",
        title: "ESP vs. Marketing Automation Platform",
        description:
          "The line between a classic ESP and a full marketing automation platform keeps blurring. Here is how to tell them apart and which one fits your stage.",
        readingTime: "5 min read",
        draft: true,
        sections: [
          {
            id: "the-difference",
            heading: "The core difference",
            body: ["Placeholder: define each category and where they overlap."]
          },
          {
            id: "which-stage",
            heading: "Which one fits your stage",
            body: ["Placeholder: map company stage to the right tool."]
          }
        ]
      },
      {
        slug: "how-email-deliverability-works",
        title: "How email deliverability actually works",
        description:
          "Hitting 'send' is the easy part. This is how inbox providers decide whether your email lands in the inbox, the promotions tab, or spam.",
        readingTime: "8 min read",
        draft: true,
        sections: [
          {
            id: "reputation",
            heading: "Sender reputation",
            body: ["Placeholder: explain domain and IP reputation."]
          },
          {
            id: "authentication",
            heading: "Authentication signals",
            body: ["Placeholder: SPF, DKIM, DMARC at a glance."]
          },
          {
            id: "engagement",
            heading: "Engagement signals",
            body: ["Placeholder: how opens, clicks, and complaints feed back in."]
          }
        ]
      }
    ]
  },
  {
    id: "choosing-an-esp",
    title: "Choosing an ESP",
    blurb: "Frameworks and comparisons for picking the right platform.",
    articles: [
      {
        slug: "which-esp-should-you-choose",
        title: "Which ESP should you choose? A decision framework",
        description:
          "There is no single best ESP — only the best one for your list size, budget, and growth plans. Use this framework to narrow the field in an afternoon.",
        readingTime: "9 min read",
        draft: true,
        sections: [
          {
            id: "criteria",
            heading: "The criteria that matter",
            body: ["Placeholder: deliverability, automation depth, pricing, integrations, support."]
          },
          {
            id: "by-use-case",
            heading: "Recommendations by use case",
            body: ["Placeholder: ecommerce, B2B SaaS, media/newsletters, nonprofits."]
          },
          {
            id: "shortlist",
            heading: "Building your shortlist",
            body: ["Placeholder: how to run a structured trial."]
          }
        ]
      },
      {
        slug: "comparing-esps",
        title: "Klaviyo vs. Mailchimp vs. Braze: how to compare",
        description:
          "A like-for-like comparison framework you can apply to any set of providers, with the trade-offs that rarely show up on a pricing page.",
        readingTime: "10 min read",
        draft: true,
        sections: [
          {
            id: "feature-matrix",
            heading: "Building a feature matrix",
            body: ["Placeholder: the rows that actually differentiate platforms."]
          },
          {
            id: "hidden-costs",
            heading: "Hidden costs and lock-in",
            body: ["Placeholder: overage pricing, migration friction, contract terms."]
          }
        ]
      },
      {
        slug: "esp-pricing-explained",
        title: "ESP pricing models explained",
        description:
          "Per-contact, per-send, per-seat, credits — pricing models vary wildly. Here is how to compare them apples-to-apples and avoid overpaying as you grow.",
        readingTime: "7 min read",
        draft: true,
        sections: [
          {
            id: "models",
            heading: "The common pricing models",
            body: ["Placeholder: walk through each model."]
          },
          {
            id: "forecasting",
            heading: "Forecasting your real cost",
            body: ["Placeholder: model cost at 10x your current list."]
          }
        ]
      },
      {
        slug: "migrating-between-esps",
        title: "Migrating from one ESP to another without losing data",
        description:
          "A step-by-step migration playbook: what to export, how to warm a new sending domain, and how to avoid a deliverability dip during the cutover.",
        readingTime: "11 min read",
        draft: true,
        sections: [
          {
            id: "checklist",
            heading: "Pre-migration checklist",
            body: ["Placeholder: data, flows, integrations, domains."]
          },
          {
            id: "warming",
            heading: "Warming your new domain",
            body: ["Placeholder: ramp schedule and monitoring."]
          }
        ]
      }
    ]
  },
  {
    id: "email-strategy",
    title: "Email Strategy",
    blurb: "Timing, cadence, and the campaigns worth building first.",
    articles: [
      {
        slug: "when-to-send-newsletters",
        title: "When should you send out newsletters?",
        description:
          "Best send times by industry and audience — and why the 'best time to send' is something you should ultimately discover from your own data.",
        readingTime: "6 min read",
        draft: true,
        sections: [
          {
            id: "by-industry",
            heading: "Best send times by industry",
            body: ["Placeholder: benchmark windows for B2B, ecommerce, media."]
          },
          {
            id: "timezones",
            heading: "Handling multiple time zones",
            body: ["Placeholder: send-time optimization vs. fixed schedules."]
          },
          {
            id: "test-your-own",
            heading: "Finding your audience's best time",
            body: ["Placeholder: how to test send time on your own list."]
          }
        ]
      },
      {
        slug: "how-often-to-email",
        title: "How often should you email your list?",
        description:
          "Send too little and you go cold; send too much and you burn the list. How to find a cadence your subscribers actually want.",
        readingTime: "5 min read",
        draft: true,
        sections: [
          {
            id: "signals",
            heading: "Signals you're emailing too much (or too little)",
            body: ["Placeholder: unsubscribes, complaints, dwindling opens."]
          },
          {
            id: "preference-center",
            heading: "Letting subscribers choose",
            body: ["Placeholder: preference centers and cadence options."]
          }
        ]
      },
      {
        slug: "welcome-flow",
        title: "Building a welcome flow that converts",
        description:
          "The welcome series is the highest-engagement email a subscriber ever gets. Here is a proven structure for the first few sends.",
        readingTime: "7 min read",
        draft: true,
        sections: [
          {
            id: "structure",
            heading: "A proven welcome series structure",
            body: ["Placeholder: email-by-email breakdown."]
          }
        ]
      },
      {
        slug: "re-engagement-campaigns",
        title: "Re-engagement campaigns: winning back dormant subscribers",
        description:
          "Before you delete inactive contacts, give them one good reason to come back. How to design a win-back flow that protects your deliverability.",
        readingTime: "6 min read",
        draft: true,
        sections: [
          {
            id: "when",
            heading: "When to trigger a win-back",
            body: ["Placeholder: defining 'dormant' for your list."]
          },
          {
            id: "sunset",
            heading: "Sunsetting unresponsive contacts",
            body: ["Placeholder: protecting sender reputation."]
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
          "A practical, run-before-every-send checklist covering authentication, list hygiene, content, and engagement.",
        readingTime: "8 min read",
        draft: true,
        sections: [
          {
            id: "checklist",
            heading: "The pre-send checklist",
            body: ["Placeholder: the items to verify before every campaign."]
          }
        ]
      },
      {
        slug: "spf-dkim-dmarc",
        title: "SPF, DKIM, and DMARC explained",
        description:
          "The three DNS records that prove your email is really from you. What each one does and how to set them up without breaking sending.",
        readingTime: "9 min read",
        draft: true,
        sections: [
          {
            id: "spf",
            heading: "SPF",
            body: ["Placeholder: what SPF authorizes and how to set it."]
          },
          {
            id: "dkim",
            heading: "DKIM",
            body: ["Placeholder: signing and key rotation."]
          },
          {
            id: "dmarc",
            heading: "DMARC",
            body: ["Placeholder: policy, alignment, and reporting."]
          }
        ]
      },
      {
        slug: "gdpr-and-can-spam",
        title: "GDPR and CAN-SPAM: staying compliant",
        description:
          "A plain-English overview of the consent, disclosure, and unsubscribe rules that apply to marketing email in the EU and US.",
        readingTime: "7 min read",
        draft: true,
        sections: [
          {
            id: "consent",
            heading: "Consent and opt-in",
            body: ["Placeholder: opt-in standards by region."]
          },
          {
            id: "unsubscribe",
            heading: "Unsubscribe requirements",
            body: ["Placeholder: timing and mechanics."]
          }
        ]
      }
    ]
  },
  {
    id: "measuring-performance",
    title: "Measuring Performance",
    blurb: "The metrics that matter and how to read them after privacy changes.",
    articles: [
      {
        slug: "email-metrics-that-matter",
        title: "The email metrics that actually matter",
        description:
          "Open rate gets all the attention, but it is one of the least reliable numbers you track. The metrics that actually predict revenue.",
        readingTime: "6 min read",
        draft: true,
        sections: [
          {
            id: "vanity-vs-real",
            heading: "Vanity metrics vs. real signals",
            body: ["Placeholder: clicks, conversions, revenue per recipient."]
          }
        ]
      },
      {
        slug: "open-rates-after-mpp",
        title: "Open rates after Apple Mail Privacy Protection",
        description:
          "Apple's Mail Privacy Protection inflated open rates and broke open-based automation. How to adapt your reporting and your flows.",
        readingTime: "5 min read",
        draft: true,
        sections: [
          {
            id: "what-changed",
            heading: "What changed",
            body: ["Placeholder: how MPP pre-fetches images."]
          },
          {
            id: "what-to-track",
            heading: "What to track instead",
            body: ["Placeholder: click-based and conversion-based metrics."]
          }
        ]
      },
      {
        slug: "ab-testing-email",
        title: "A/B testing your email campaigns",
        description:
          "How to run email A/B tests that produce decisions you can trust — sample sizes, what to test, and what to ignore.",
        readingTime: "7 min read",
        draft: true,
        sections: [
          {
            id: "what-to-test",
            heading: "What's worth testing",
            body: ["Placeholder: subject lines, send time, content, CTA."]
          },
          {
            id: "significance",
            heading: "Reaching a trustworthy result",
            body: ["Placeholder: sample size and significance."]
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
