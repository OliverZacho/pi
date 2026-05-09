import type { ParsedLink } from "./extract-metadata";

export type EspProvider =
  | "mailchimp"
  | "klaviyo"
  | "hubspot"
  | "sendgrid"
  | "braze"
  | "iterable"
  | "customerio"
  | "salesforce_mc"
  | "marketo"
  | "omnisend"
  | "activecampaign"
  | "constantcontact"
  | "drip"
  | "attentive"
  | "sendinblue"
  | "shopify_email"
  | "substack"
  | "beehiiv"
  | "convertkit"
  | "mailerlite"
  | "mailgun"
  | "postmark"
  | "amazon_ses"
  | "mailjet"
  | "apsis"
  | "unknown";

export type EspSignal = {
  kind: "dkim_d" | "return_path" | "list_unsubscribe" | "link_host" | "image_host" | "html_marker" | "x_header" | "feedback_id";
  detail: string;
};

export type EspDetectionResult = {
  provider: EspProvider;
  confidence: number;
  signals: EspSignal[];
  candidates: Array<{ provider: EspProvider; score: number }>;
};

export type DetectEspInput = {
  headers?: Record<string, string> | null;
  html?: string;
  links?: ParsedLink[];
  resourceHosts?: string[];
};

type Fingerprint = {
  provider: Exclude<EspProvider, "unknown">;
  hostPatterns?: RegExp[];
  htmlPatterns?: RegExp[];
  dkimPatterns?: RegExp[];
  returnPathPatterns?: RegExp[];
  feedbackIdPatterns?: RegExp[];
  xHeaderNames?: string[];
};

const FINGERPRINTS: Fingerprint[] = [
  {
    provider: "mailchimp",
    hostPatterns: [
      /(^|\.)list-manage\.com$/i,
      /(^|\.)mcsv\.net$/i,
      /(^|\.)mcusercontent\.com$/i,
      /(^|\.)gallery\.mailchimp\.com$/i,
      /(^|\.)campaign-archive\.com$/i
    ],
    htmlPatterns: [/\*\|MC[:_][A-Z_]+\|\*/, /list-manage\.com/i],
    dkimPatterns: [/(^|[\s,;:=])(mailchimpapp\.com|mcsv\.net|mcdlv\.net)/i],
    returnPathPatterns: [/bounce-mc[^@]*@/i, /mcsv\.net/i],
    xHeaderNames: ["x-mc-user", "x-mailchimp-id"]
  },
  {
    provider: "klaviyo",
    hostPatterns: [
      /(^|\.)klaviyo\.com$/i,
      /(^|\.)klaviyomail\.com$/i,
      /(^|\.)trk\.klaviyomail\.com$/i,
      /(^|\.)go\.klaviyo\.com$/i,
      /(^|\.)email\.klaviyomail\.com$/i,
      /(^|\.)d3k81ch9hvuctc\.cloudfront\.net$/i
    ],
    htmlPatterns: [
      /klaviyo/i,
      /\bclass\s*=\s*["'][^"']*\bkl-(?:row|column|button|hlb|table-subblock|img-base-auto-width)\b/i,
      /\b_kx\b/,
      /\b_ke\b/
    ],
    dkimPatterns: [/klaviyo\.com/i, /klaviyomail\.com/i, /sendgrid\.net/i],
    returnPathPatterns: [/bounces\.klaviyo\.com/i, /klaviyomail\.com/i],
    xHeaderNames: ["x-klaviyo-message-id", "x-klaviyo-account"]
  },
  {
    provider: "hubspot",
    hostPatterns: [
      /(^|\.)hs-sites\.com$/i,
      /(^|\.)hubspotemail\.net$/i,
      /(^|\.)hubspotlinks\.com$/i,
      /(^|\.)hs-sendcdn\.net$/i,
      /(^|\.)hubspotusercontent[0-9-]*\.net$/i,
      /(^|\.)hs-fs\.net$/i
    ],
    htmlPatterns: [/_hsenc=/i, /_hsmi=/i],
    dkimPatterns: [/hubspotemail\.net/i],
    returnPathPatterns: [/hubspotemail\.net/i],
    xHeaderNames: ["x-hs-marketing-email-id", "x-hubspot-portal-id"]
  },
  {
    provider: "sendgrid",
    hostPatterns: [/(^|\.)sendgrid\.net$/i, /(^|\.)mailanyone\.net$/i],
    dkimPatterns: [/sendgrid\.net/i, /sendgrid\.info/i],
    returnPathPatterns: [/bounces?\.sendgrid\.net/i, /sendgrid\.net/i],
    xHeaderNames: ["x-sg-eid", "x-sg-id"]
  },
  {
    provider: "braze",
    hostPatterns: [
      /(^|\.)bnc\.lt$/i,
      /(^|\.)sparkpostmail\.com$/i,
      /(^|\.)sparkpostmail1\.com$/i,
      /(^|\.)braze\.com$/i
    ],
    dkimPatterns: [/braze\.com/i, /sparkpostmail/i],
    returnPathPatterns: [/sparkpostmail/i, /braze\.com/i],
    xHeaderNames: ["x-braze-message-id", "x-braze-dispatch-id"]
  },
  {
    provider: "iterable",
    hostPatterns: [
      /(^|\.)iterable\.com$/i,
      /(^|\.)links\.[a-z0-9-]+\.iterable\.com$/i,
      /(^|\.)mailings\.iterable\.com$/i
    ],
    htmlPatterns: [/iterableCampaignId=/i, /iterableTemplateId=/i],
    dkimPatterns: [/iterable\.com/i],
    returnPathPatterns: [/iterable\.com/i],
    xHeaderNames: ["x-iterable-message-id", "x-iterable-campaign-id"]
  },
  {
    provider: "customerio",
    hostPatterns: [
      /(^|\.)customeriomail\.com$/i,
      /(^|\.)track\.customer\.io$/i,
      /(^|\.)customer\.io$/i
    ],
    dkimPatterns: [/customer\.io/i, /customeriomail\.com/i],
    returnPathPatterns: [/customeriomail\.com/i],
    xHeaderNames: ["x-cio-message-id"]
  },
  {
    provider: "salesforce_mc",
    hostPatterns: [
      /(^|\.)exct\.net$/i,
      /(^|\.)cl\.s[0-9]+\.exct\.net$/i,
      /(^|\.)exacttarget\.com$/i
    ],
    dkimPatterns: [/exacttarget\.com/i, /exct\.net/i],
    returnPathPatterns: [/exct\.net/i, /bounce\.s[0-9]+\.exacttarget\.com/i],
    xHeaderNames: ["x-sfmc-stack-id", "x-job-id"]
  },
  {
    provider: "marketo",
    hostPatterns: [/(^|\.)mktoresp\.com$/i, /(^|\.)marketo\.com$/i, /(^|\.)mktdns\.com$/i],
    htmlPatterns: [/mkt_tok=/i],
    dkimPatterns: [/mktdns\.com/i, /marketo\.com/i],
    returnPathPatterns: [/mktdns\.com/i],
    xHeaderNames: ["x-mktomailchain-id", "x-marketo-tenant"]
  },
  {
    provider: "omnisend",
    hostPatterns: [/(^|\.)omnisend\.com$/i, /(^|\.)links\.omnisend\.com$/i],
    dkimPatterns: [/omnisend\.com/i],
    returnPathPatterns: [/omnisend\.com/i],
    xHeaderNames: ["x-omnisend-mail-id"]
  },
  {
    provider: "activecampaign",
    hostPatterns: [/(^|\.)activehosted\.com$/i],
    dkimPatterns: [/activehosted\.com/i, /activecampaign\.com/i],
    returnPathPatterns: [/activehosted\.com/i],
    xHeaderNames: ["x-ac-mailtype"]
  },
  {
    provider: "constantcontact",
    hostPatterns: [/(^|\.)constantcontact\.com$/i, /(^|\.)r20\.rs6\.net$/i, /(^|\.)ccsend\.com$/i],
    dkimPatterns: [/constantcontact\.com/i, /ccsend\.com/i],
    returnPathPatterns: [/in\.constantcontact\.com/i, /ccsend\.com/i],
    xHeaderNames: ["x-roving-id", "x-mailer"]
  },
  {
    provider: "drip",
    hostPatterns: [/(^|\.)getdrip\.com$/i],
    dkimPatterns: [/getdrip\.com/i],
    returnPathPatterns: [/getdrip\.com/i],
    xHeaderNames: ["x-drip-message-id"]
  },
  {
    provider: "attentive",
    hostPatterns: [
      /(^|\.)attn\.tv$/i,
      /(^|\.)attentivemobile\.com$/i,
      /(^|\.)attentive\.com$/i
    ],
    dkimPatterns: [/attentivemobile\.com/i, /attentive\.com/i],
    returnPathPatterns: [/attentivemobile\.com/i],
    xHeaderNames: ["x-attentive-message-id"]
  },
  {
    provider: "sendinblue",
    hostPatterns: [
      /(^|\.)sendinblue\.com$/i,
      /(^|\.)sib(?:tracking)?\.app$/i,
      /(^|\.)brevo\.com$/i,
      /(^|\.)mailin\.fr$/i
    ],
    dkimPatterns: [/sendinblue\.com/i, /brevo\.com/i, /mailin\.fr/i],
    returnPathPatterns: [/sendinblue\.com/i, /brevo\.com/i],
    xHeaderNames: ["x-mailin-eid", "x-sib-id"]
  },
  {
    provider: "shopify_email",
    hostPatterns: [
      /(^|\.)shopifyemail\.com$/i,
      /(^|\.)delivery\.shopifyemail\.com$/i,
      /(^|\.)email\.shopify\.com$/i
    ],
    dkimPatterns: [/shopifyemail\.com/i, /shopify\.com/i],
    returnPathPatterns: [/bounces?\.shopifyemail\.com/i, /shopifyemail\.com/i],
    xHeaderNames: ["x-shopify-email-id", "x-shopify-template-id"]
  },
  {
    provider: "substack",
    hostPatterns: [
      /(^|\.)substack\.com$/i,
      /(^|\.)email\.substack\.com$/i,
      /(^|\.)substackcdn\.com$/i
    ],
    htmlPatterns: [/substack\.com/i, /\bsubstack-feedback\b/i],
    dkimPatterns: [/substack\.com/i],
    returnPathPatterns: [/bounce[^@]*@(?:[^\s>]*)?substack\.com/i],
    xHeaderNames: ["x-substack-post-id", "x-substack-publication-id"]
  },
  {
    provider: "beehiiv",
    hostPatterns: [
      /(^|\.)beehiiv\.com$/i,
      /(^|\.)mail\.beehiiv\.com$/i,
      /(^|\.)media\.beehiiv\.com$/i
    ],
    htmlPatterns: [/beehiiv\.com/i],
    dkimPatterns: [/beehiiv\.com/i, /mail\.beehiiv\.com/i],
    returnPathPatterns: [/beehiiv\.com/i],
    xHeaderNames: ["x-beehiiv-message-id"]
  },
  {
    provider: "convertkit",
    hostPatterns: [
      /(^|\.)convertkit-mail2?\.com$/i,
      /(^|\.)convertkit\.com$/i,
      /(^|\.)kit\.com$/i,
      /(^|\.)ck-assets\.com$/i
    ],
    dkimPatterns: [/convertkit-mail2?\.com/i, /convertkit\.com/i, /kit\.com/i],
    returnPathPatterns: [/convertkit-mail2?\.com/i, /kit\.com/i],
    xHeaderNames: ["x-ck-message-id", "x-convertkit-message-id"]
  },
  {
    provider: "mailerlite",
    hostPatterns: [
      /(^|\.)mailerlite\.com$/i,
      /(^|\.)mlsend\.com$/i,
      /(^|\.)email\.mailerlite\.com$/i
    ],
    htmlPatterns: [/mailerlite/i],
    dkimPatterns: [/mailerlite\.com/i, /mlsend\.com/i],
    returnPathPatterns: [/mailerlite\.com/i, /mlsend\.com/i],
    xHeaderNames: ["x-ml-message-id", "x-mailerlite-id"]
  },
  {
    provider: "mailgun",
    hostPatterns: [
      /(^|\.)mailgun\.org$/i,
      /(^|\.)mailgun\.net$/i,
      /(^|\.)email\.mailgun\.net$/i
    ],
    dkimPatterns: [/mailgun\.org/i, /mailgun\.net/i],
    returnPathPatterns: [/mailgun\.org/i, /mailgun\.net/i],
    xHeaderNames: ["x-mailgun-sid", "x-mailgun-message-id"]
  },
  {
    provider: "postmark",
    hostPatterns: [
      /(^|\.)mtasv\.net$/i,
      /(^|\.)postmarkapp\.com$/i,
      /(^|\.)pm-bounces\.com$/i,
      /(^|\.)pmrdy\.com$/i
    ],
    dkimPatterns: [/postmarkapp\.com/i, /mtasv\.net/i],
    returnPathPatterns: [/mtasv\.net/i, /postmarkapp\.com/i, /pm-bounces\.com/i],
    xHeaderNames: ["x-pm-message-id", "x-postmark-server-token"]
  },
  {
    provider: "amazon_ses",
    hostPatterns: [
      /(^|\.)amazonses\.com$/i,
      /(^|\.)email\.amazonses\.com$/i,
      /(^|\.)email-smtp\.[a-z0-9-]+\.amazonaws\.com$/i,
      /(^|\.)simpleemailservice\.com$/i
    ],
    dkimPatterns: [/amazonses\.com/i],
    returnPathPatterns: [/amazonses\.com/i, /simpleemailservice\.com/i],
    xHeaderNames: ["x-ses-outgoing", "x-ses-message-id", "x-ses-configuration-set"]
  },
  {
    provider: "mailjet",
    hostPatterns: [
      /(^|\.)mailjet\.com$/i,
      /(^|\.)mjt\.lu$/i,
      /(^|\.)track\.mailjet\.com$/i
    ],
    dkimPatterns: [/mailjet\.com/i],
    returnPathPatterns: [/mailjet\.com/i, /mjt\.lu/i],
    xHeaderNames: ["x-mj-id", "x-mj-mid", "x-mj-templateid"]
  },
  {
    provider: "apsis",
    hostPatterns: [
      /(^|\.)apsis\.one$/i,
      /(^|\.)tr\.apsis\.one$/i,
      /(^|\.)images\.apsis\.one$/i,
      /(^|\.)static\.images\.apsis\.one$/i,
      /(^|\.)aonetrk\.com$/i,
      /(^|\.)apsismail\.com$/i,
      /(^|\.)anpdm\.com$/i
    ],
    htmlPatterns: [
      /apsis\.one/i,
      /\bdata-link-id\s*=\s*["']ln_/i,
      /\baonetrk\.com\b/i
    ],
    dkimPatterns: [/apsis\.one/i, /apsismail\.com/i, /anpdm\.com/i, /efficy\.com/i],
    returnPathPatterns: [/apsis\.one/i, /apsismail\.com/i, /anpdm\.com/i],
    xHeaderNames: ["x-apsis-message-id", "x-apsis-mailing-id"]
  }
];

const SIGNAL_WEIGHT: Record<EspSignal["kind"], number> = {
  dkim_d: 0.55,
  return_path: 0.45,
  feedback_id: 0.45,
  list_unsubscribe: 0.4,
  x_header: 0.4,
  link_host: 0.35,
  image_host: 0.25,
  html_marker: 0.2
};

const CONFIDENCE_THRESHOLD = 0.6;

const MAX_HTML_MARKERS_PER_PROVIDER = 2;

export function detectEsp(input: DetectEspInput): EspDetectionResult {
  const headerLookup = lowerCaseHeaders(input.headers ?? null);
  const dkimDomain = parseDkimDomain(headerLookup["dkim-signature"]);
  const arcDkimDomain = parseDkimDomain(headerLookup["arc-message-signature"]);
  const returnPath = headerLookup["return-path"] ?? headerLookup["sender"] ?? "";
  const listUnsubscribe = headerLookup["list-unsubscribe"] ?? "";
  const feedbackId = headerLookup["feedback-id"] ?? "";
  const html = input.html ?? "";
  const links = input.links ?? [];
  const linkHosts = new Set(
    links.map((link) => link.host?.toLowerCase() ?? "").filter(Boolean)
  );
  for (const host of input.resourceHosts ?? []) {
    if (host) {
      linkHosts.add(host.toLowerCase());
    }
  }
  const candidateHosts = [...linkHosts];

  const scoreByProvider = new Map<Exclude<EspProvider, "unknown">, number>();
  const signalsByProvider = new Map<Exclude<EspProvider, "unknown">, EspSignal[]>();

  function addSignal(
    provider: Exclude<EspProvider, "unknown">,
    signal: EspSignal
  ): void {
    const weight = SIGNAL_WEIGHT[signal.kind];
    scoreByProvider.set(provider, (scoreByProvider.get(provider) ?? 0) + weight);
    const list = signalsByProvider.get(provider) ?? [];
    list.push(signal);
    signalsByProvider.set(provider, list);
  }

  for (const fp of FINGERPRINTS) {
    if (fp.dkimPatterns) {
      for (const pattern of fp.dkimPatterns) {
        if (dkimDomain && pattern.test(dkimDomain)) {
          addSignal(fp.provider, { kind: "dkim_d", detail: dkimDomain });
          break;
        }
        if (arcDkimDomain && pattern.test(arcDkimDomain)) {
          addSignal(fp.provider, { kind: "dkim_d", detail: arcDkimDomain });
          break;
        }
      }
    }

    if (fp.returnPathPatterns) {
      for (const pattern of fp.returnPathPatterns) {
        if (returnPath && pattern.test(returnPath)) {
          addSignal(fp.provider, { kind: "return_path", detail: returnPath });
          break;
        }
      }
    }

    if (fp.hostPatterns) {
      for (const pattern of fp.hostPatterns) {
        const matchedHost = candidateHosts.find((host) => pattern.test(host));
        if (matchedHost) {
          addSignal(fp.provider, { kind: "link_host", detail: matchedHost });
          break;
        }
        if (listUnsubscribe && pattern.test(listUnsubscribe)) {
          addSignal(fp.provider, { kind: "list_unsubscribe", detail: listUnsubscribe });
          break;
        }
      }
    }

    if (fp.htmlPatterns) {
      let htmlMarkerCount = 0;
      const seenDetails = new Set<string>();
      for (const pattern of fp.htmlPatterns) {
        if (htmlMarkerCount >= MAX_HTML_MARKERS_PER_PROVIDER) {
          break;
        }
        const match = html.match(pattern);
        if (match) {
          const detail = match[0].slice(0, 80);
          if (seenDetails.has(detail)) {
            continue;
          }
          seenDetails.add(detail);
          addSignal(fp.provider, { kind: "html_marker", detail });
          htmlMarkerCount += 1;
        }
      }
    }

    if (fp.xHeaderNames) {
      for (const name of fp.xHeaderNames) {
        const value = headerLookup[name];
        if (value) {
          addSignal(fp.provider, { kind: "x_header", detail: `${name}=${value.slice(0, 80)}` });
          break;
        }
      }
    }

    if (feedbackId && fp.feedbackIdPatterns) {
      for (const pattern of fp.feedbackIdPatterns) {
        if (pattern.test(feedbackId)) {
          addSignal(fp.provider, { kind: "feedback_id", detail: feedbackId });
          break;
        }
      }
    }
  }

  const candidates = [...scoreByProvider.entries()]
    .map(([provider, rawScore]) => ({
      provider,
      score: clamp01(rawScore)
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return {
      provider: "unknown",
      confidence: 0,
      signals: [],
      candidates: []
    };
  }

  const winner = candidates[0];
  if (winner.score < CONFIDENCE_THRESHOLD) {
    return {
      provider: "unknown",
      confidence: Number(winner.score.toFixed(3)),
      signals: signalsByProvider.get(winner.provider) ?? [],
      candidates: candidates.map((c) => ({
        provider: c.provider,
        score: Number(c.score.toFixed(3))
      }))
    };
  }

  return {
    provider: winner.provider,
    confidence: Number(winner.score.toFixed(3)),
    signals: signalsByProvider.get(winner.provider) ?? [],
    candidates: candidates.map((c) => ({
      provider: c.provider,
      score: Number(c.score.toFixed(3))
    }))
  };
}

function lowerCaseHeaders(
  headers: Record<string, string> | null
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === "string" && typeof value === "string") {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

function parseDkimDomain(dkim: string | undefined): string | null {
  if (!dkim) {
    return null;
  }
  const match = dkim.match(/(?:^|;|\s)d\s*=\s*([A-Za-z0-9.\-_]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
