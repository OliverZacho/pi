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
  | "agillic"
  | "peytzmail"
  | "pure360"
  | "heyloyalty"
  | "exponea"
  | "unknown";

export type EspSignal = {
  kind:
    | "dkim_d"
    | "return_path"
    | "list_unsubscribe"
    | "link_host"
    | "image_host"
    | "link_url"
    | "html_marker"
    | "x_header"
    | "feedback_id";
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
  /**
   * Tested against the full URL strings of parsed `<a>` links. These typically
   * encode tracking-URL shapes that are highly distinctive to a provider even
   * when the host has been CNAMEd to the brand's own domain (e.g. SFMC's
   * `?qs=…` and `/open.aspx?…&bmt=…` shapes). Matches are scored at the same
   * weight as `link_host` so they survive even when the host itself looks
   * brand-owned.
   */
  linkUrlPatterns?: RegExp[];
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
    // SFMC Email Studio / Content Builder leaves very distinctive markup and
    // URL shapes in the rendered HTML. These let us detect tenants that route
    // through CNAMEd custom tracking domains (e.g. click.<brand>.com,
    // image.<brand>.com) where the host fingerprints don't match.
    //
    // The first three patterns target highly distinctive URL shapes (the
    // `open.aspx?…&bmt=…` tracking pixel, the `?qs=…` click-CNAME redirect, and
    // the `/lib/<hex>/m/N/` Content Builder asset path) so the strongest
    // signals are counted first — `MAX_HTML_MARKERS_PER_PROVIDER` caps how
    // many of these contribute, and we want the most reliable fingerprints to
    // win that race over generic class names.
    htmlPatterns: [
      /\/open\.aspx\?[A-Za-z0-9]+\.\d+&(?:amp;)?d=\d+&(?:amp;)?bmt=\d+/i,
      /\bclick\.[a-z0-9.-]+\/(?:[^\s"'<>]*\?)?qs=[A-Za-z0-9_-]{8,}/i,
      /\b[a-z0-9.-]+\/lib\/[a-f0-9]{20,}\/m\/\d+\//i,
      /\bstylingblock-content-wrapper\b/,
      /\b(?:x_)?camarker-inner\b/,
      /\bdata-linkto\s*=\s*["']/i,
      /\bdata-assetid\s*=\s*["']\d+["']/i
    ],
    // Matching against full link URLs (independent of the HTML-pattern cap)
    // gives us an extra `link_host`-weight signal so SFMC scores well above
    // the threshold whenever any of these tracking shapes are present.
    linkUrlPatterns: [
      /\bclick\.[a-z0-9.-]+\/(?:[^\s"'<>]*\?)?qs=[A-Za-z0-9_-]{8,}/i,
      /\/open\.aspx\?[A-Za-z0-9]+\.\d+&(?:amp;)?d=\d+&(?:amp;)?bmt=\d+/i
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
    hostPatterns: [
      /(^|\.)activehosted\.com$/i,
      /(^|\.)activecampaign\.com$/i,
      /(^|\.)acemln[a-z]\.com$/i,
      /(^|\.)acemlnpages\.com$/i,
      /(^|\.)acemlnpc\.com$/i
    ],
    // ActiveCampaign leaves four very distinctive URL shapes that survive
    // brand-CNAMEd tracking hosts (e.g. `news.<brand>.com` pointed at AC):
    //   /lt.php?x=<urlsafe-base64>
    //     → link-click tracker (also reused as open pixel when emitted as an <img>)
    //   /proc.php?nl=<num>&c=<num>&m=<num>&s=<hex>&act=unsub&runid=<num>
    //     → list-unsubscribe processor — the `act=unsub` + `runid=` combo is
    //       unique to AC's unsubscribe handler
    //   /p_v.php?l=<num>&c=<num>&m=<num>
    //     → "View in browser" web-view link
    //   /content/<TENANT>/<YYYY>/<MM>/<DD>/<uuid>.<ext>
    //     → AC's hosted asset / content-image path (survives Cloudflare's
    //       `/cdn-cgi/image/.../content/<TENANT>/<DATE>/<uuid>` wrapper that
    //       AC enables for image resizing on custom tracking domains)
    // The URL-shape patterns are listed FIRST so that the
    // `MAX_HTML_MARKERS_PER_PROVIDER` cap prefers the strongest fingerprints.
    htmlPatterns: [
      /\/lt\.php\?x=[A-Za-z0-9._~/+=-]{6,}/i,
      /\/proc\.php\?[^"'<>\s]*\bact=unsub(?:&amp;|&)runid=\d+/i,
      /\/p_v\.php\?l=\d+(?:&amp;|&)c=\d+(?:&amp;|&)m=\d+/i,
      /\/content\/[A-Z0-9]{4,}\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9-]{8,}\.[a-z]{2,4}/i,
      /(^|\.)acemln[a-z]\.com\//i,
      /\.acemln[a-z]\.com\/(?:lt|proc|p_v|open)\.php\b/i,
      /(^|\.)activehosted\.com\/(?:lt|proc|p_v|open)\.php\b/i
    ],
    // Matching the same URL shapes against parsed `<a>` links gives us an
    // extra `link_url`-weight signal that clears the 0.6 confidence threshold
    // confidently on real-world sends through brand CNAMEs (where no DKIM /
    // Return-Path / x- headers are available to us).
    linkUrlPatterns: [
      /\/lt\.php\?x=[A-Za-z0-9._~/+=-]{6,}/i,
      /\/proc\.php\?[^"'<>\s]*\bact=unsub(?:&amp;|&)runid=\d+/i,
      /\/p_v\.php\?l=\d+(?:&amp;|&)c=\d+(?:&amp;|&)m=\d+/i
    ],
    dkimPatterns: [/activehosted\.com/i, /activecampaign\.com/i, /acemln[a-z]\.com/i],
    returnPathPatterns: [/activehosted\.com/i, /acemln[a-z]\.com/i],
    xHeaderNames: ["x-ac-mailtype", "x-activecampaign-id"]
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
  },
  {
    provider: "agillic",
    // The image CDN host is always `<tenant>.agilliccdn.com`. The tracking /
    // open / web-view host is usually a brand-owned CNAME (e.g.
    // `designuniverse.bolia.com`), so we lean on URL-shape patterns below.
    hostPatterns: [
      /(^|\.)agilliccdn\.com$/i,
      /(^|\.)agillic\.com$/i,
      /(^|\.)agillic\.net$/i
    ],
    // Agillic's Email Studio leaves several very distinctive markers in the
    // rendered HTML — both editor-only artifacts (the `agillicRangeMarker`
    // inline-span class, the `agavailability` meta tag, the `data-webcopy-*`
    // and `data-button-link` template attributes) and brand-CNAMEd URL shapes
    // that survive when the tracking host has been re-pointed to the brand
    // (e.g. `/api/api/webcopy/view/<base64>/<template>.html`, the
    // `/web/namedservice/?ext=<encoded-url>` redirect, the
    // `/web/open/<id>:<hash>==/open.gif` pixel, and `/api/api/checker/click`).
    htmlPatterns: [
      /\bagillicRangeMarker\b/,
      /<meta\s+name\s*=\s*["']agavailability["']/i,
      /\bdata-webcopy-link\s*=/i,
      /\/api\/api\/webcopy\/view\//i,
      /\/web\/namedservice\/\?ext=/i,
      /\/api\/api\/checker\/click\b/i,
      /\/web\/open\/[A-Za-z0-9_-]{16,}/i
    ],
    // Matching the same URL shapes against parsed `<a>` links gives us a
    // stronger `link_host`-weight signal (vs. the `html_marker` weight) so we
    // clear the 0.6 threshold confidently on real-world sends through brand
    // CNAMEs, where we have no DKIM / Return-Path headers to lean on.
    linkUrlPatterns: [
      /\/web\/namedservice\/\?ext=[^"'<>\s]+/i,
      /\/api\/api\/webcopy\/view\/[^"'<>\s]+/i,
      /\/api\/api\/checker\/click\b/i,
      /\/web\/page\/[A-Za-z0-9_-]+\?pv=/i
    ],
    dkimPatterns: [/agillic\.com/i, /agilliccdn\.com/i],
    returnPathPatterns: [/agillic\.com/i, /agilliccdn\.com/i],
    xHeaderNames: ["x-agillic-message-id", "x-agillic-trace-id"]
  },
  {
    provider: "peytzmail",
    // Peytzmail (the Danish ESP from Peytz & Co) hosts every tenant on
    // `<tenant>.peytzmail.com` for tracking + web-view + unsubscribe, serves
    // resized images from `img.peytzmail.com` (a Cloudinary instance), and
    // occasionally uses a shared `peytzmail.s3*.amazonaws.com` bucket for
    // static template assets. Brand CNAMEs do exist in the wild, so we lean
    // on the URL-shape patterns below for those cases.
    hostPatterns: [
      /(^|\.)peytzmail\.com$/i,
      /(^|\.)peytzmail\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/i
    ],
    // The tracking URL shapes are highly distinctive:
    //   /c/<3-char-id>/<24-hex-hash>/<token>/<context>/<numeric-id>?t=<dest>
    //     → click redirect (the human-readable `<context>` slug like
    //       `header-logo-image`, `article-title`, `text-social-media` is a
    //       Peytzmail-only convention)
    //   /r/<24-hex-hash>/<token>/<numeric-id>?[f=t&]t=<dest>
    //     → image / open-pixel redirect (`?f=t&t=spacer.gif` is the
    //       open-tracking pixel signature)
    //   /v/<24-hex-hash>/<token>/<numeric-id>/send
    //     → "Read online" web-view link
    //   /unsubscribe/<24-hex-hash>/<numeric-id>?email=<recipient>
    //     → list-unsubscribe link
    htmlPatterns: [
      /\bpeytzmail\.com\b/i,
      /\/c\/[a-z0-9]{3}\/[a-f0-9]{20,}\/[a-z0-9]+\/[a-z0-9-]+\/\d+\?t=/i,
      /\/r\/[a-f0-9]{20,}\/[a-z0-9]+\/\d+\?(?:f=[a-z]&(?:amp;)?)?t=/i,
      /\/unsubscribe\/[a-f0-9]{20,}\/\d+\?email=/i
    ],
    linkUrlPatterns: [
      /\/c\/[a-z0-9]{3}\/[a-f0-9]{20,}\/[a-z0-9]+\/[a-z0-9-]+\/\d+\?t=/i,
      /\/r\/[a-f0-9]{20,}\/[a-z0-9]+\/\d+\?(?:f=[a-z]&)?t=/i,
      /\/v\/[a-f0-9]{20,}\/[a-z0-9]+\/\d+\/send\b/i,
      /\/unsubscribe\/[a-f0-9]{20,}\/\d+\?email=/i
    ],
    dkimPatterns: [/peytzmail\.com/i, /peytz\.dk/i],
    returnPathPatterns: [/peytzmail\.com/i, /bounce[^@]*@[^>\s]*peytz/i],
    xHeaderNames: ["x-peytzmail-id", "x-peytz-mailing-id"]
  },
  {
    provider: "pure360",
    // Pure360 (acquired by Spotler Group in 2022 and rebranded under their
    // SendPro / Mail+ stack) hosts campaign images on `i.emlfiles4.com`
    // (`/cmpimg/<digits>/files/...`), serves the default tracking host as
    // `c.spotler.com` (with paths like `/m<NN>/links/...`), and lets tenants
    // CNAME a brand domain (e.g. `email.<brand>.com`) at the same tracking
    // edge. On those CNAMEd sends we lean on the URL-shape and HTML-marker
    // patterns below.
    hostPatterns: [
      /(^|\.)emlfiles4\.com$/i,
      /(^|\.)c\.spotler\.com$/i,
      /(^|\.)r\.spotler\.com$/i,
      /(^|\.)tr\.spotler\.email$/i,
      /(^|\.)spotler\.email$/i,
      /(^|\.)spotlermail\.com$/i,
      /(^|\.)pure360\.com$/i
    ],
    // Pure360's "Easy Editor" template engine leaves several highly
    // distinctive markers in the rendered HTML — both editor-only artifacts
    // (the `ee-template-version` root attribute, the `ee_responsive_campaign`
    // root table class, the `ee_dropzone` slot class) and brand-CNAMEd URL
    // shapes that survive when the tracking host has been re-pointed to the
    // brand:
    //   /c/AQ<base64url>            → click redirect
    //   /cr/AQ<base64url>           → "view in browser" web-view
    //   /uns/AQ<base64url>          → list-unsubscribe handler
    //   /o/AQ<base64url>/o.gif      → open-tracking pixel
    // The `AQ` prefix is the consistent first two chars of Pure360's
    // base64url-encoded campaign token (length / version byte). Listing the
    // URL-shape patterns FIRST means the `MAX_HTML_MARKERS_PER_PROVIDER`
    // cap prefers the strongest fingerprints over the editor class names.
    htmlPatterns: [
      /\/c\/AQ[A-Za-z0-9_-]{40,}/,
      /\/cr\/AQ[A-Za-z0-9_-]{40,}/,
      /\/uns\/AQ[A-Za-z0-9_-]{40,}/,
      /\/o\/AQ[A-Za-z0-9_-]{40,}\/o\.gif/,
      /\bee-template-version\s*=\s*["']/i,
      /\bee_responsive_campaign\b/,
      /\bee_dropzone\b/,
      /\bved_product_element\b/,
      /(^|\.)emlfiles4\.com\//i
    ],
    // Matching the same URL shapes against parsed `<a>` links gives us extra
    // `link_url`-weight signals so we clear the 0.6 confidence threshold
    // confidently on real-world sends through brand CNAMEs (where no DKIM /
    // Return-Path / x- headers are available to us).
    linkUrlPatterns: [
      /\/c\/AQ[A-Za-z0-9_-]{40,}/,
      /\/cr\/AQ[A-Za-z0-9_-]{40,}/,
      /\/uns\/AQ[A-Za-z0-9_-]{40,}/,
      /\/o\/AQ[A-Za-z0-9_-]{40,}\/o\.gif/
    ],
    dkimPatterns: [
      /emlfiles4\.com/i,
      /spotler\.com/i,
      /spotler\.email/i,
      /pure360\.com/i,
      /spotlermail\.com/i
    ],
    returnPathPatterns: [
      /emlfiles4\.com/i,
      /spotler\.com/i,
      /spotler\.email/i,
      /pure360\.com/i,
      /spotlermail\.com/i
    ],
    xHeaderNames: ["x-pure360-id", "x-pure360-message-id", "x-spotler-message-id"]
  },
  {
    provider: "heyloyalty",
    // HeyLoyalty (the Danish/Nordic ESP) hosts everything on three subdomains
    // of `heyloyalty.com`:
    //   - `public.heyloyalty.com`  → click-redirect + open-tracking pixel
    //   - `app.heyloyalty.com`     → web-view (`/view/<base64>`) and
    //                                 unsubscribe (`/unsubscribe/<base64>/a<list>m<msg>`)
    //   - `img.heyloyalty.com`     → image CDN (`/heyloyalty1/...`)
    // Custom tracking domains via CNAME are uncommon on HeyLoyalty, but we
    // still lean on the URL-shape patterns below so a brand-CNAMEd send
    // (where the host fingerprint won't fire) still resolves.
    hostPatterns: [
      /(^|\.)heyloyalty\.com$/i
    ],
    // The click-redirect query-string shape
    //   /redirectclick?tt=<digits>.<digits>&l=<5-char-id>&msgid=<digits>&m=<uuid>&url=…
    // and the open-tracking pixel path
    //   /track/<digits>/<uuid>/<channel-slug>/<digits>.<digits>/<digits>
    // are HeyLoyalty-only. The `app.heyloyalty.com/view/` and
    // `app.heyloyalty.com/unsubscribe/<hash>/a<list>m<msg>` paths are equally
    // distinctive. The `data-uid="<5-char>"` attribute is emitted on every
    // tracked link by the HeyLoyalty editor.
    htmlPatterns: [
      /\/redirectclick\?[^"'<>\s]*\btt=\d+(?:\.\d+)?(?:&amp;|&)l=[A-Za-z0-9]{4,}(?:&amp;|&)msgid=\d+(?:&amp;|&)m=[a-f0-9-]{16,}/i,
      /\/track\/\d+\/[a-f0-9-]{16,}\/[a-z0-9_-]+\/\d+(?:\.\d+)?\/\d+/i,
      /\bapp\.heyloyalty\.com\/view\//i,
      /\bapp\.heyloyalty\.com\/unsubscribe\/[A-Za-z0-9+/=_-]{20,}\/a\d+m\d+/i,
      /\bdata-uid\s*=\s*["'][A-Za-z0-9]{5}["']/,
      /\bheyloyalty\.com\b/i
    ],
    // Matching the same URL shapes against parsed `<a>` links gives us a
    // `link_url`-weight signal (0.35) so HeyLoyalty clears the 0.6 threshold
    // confidently even when only the URL strings are available (e.g. brand
    // CNAMEs, or when only links — not the full HTML — are passed in).
    linkUrlPatterns: [
      /\/redirectclick\?[^"'<>\s]*\btt=\d+(?:\.\d+)?(?:&amp;|&)l=[A-Za-z0-9]{4,}(?:&amp;|&)msgid=\d+(?:&amp;|&)m=[a-f0-9-]{16,}/i,
      /\bapp\.heyloyalty\.com\/view\//i,
      /\bapp\.heyloyalty\.com\/unsubscribe\/[A-Za-z0-9+/=_-]{20,}\/a\d+m\d+/i
    ],
    dkimPatterns: [/heyloyalty\.com/i, /heyloyaltymail\.com/i],
    returnPathPatterns: [/heyloyalty\.com/i, /bounce[^@]*@[^>\s]*heyloyalty/i],
    xHeaderNames: ["x-heyloyalty-id", "x-heyloyalty-message-id", "x-hl-mailingid"]
  },
  {
    provider: "exponea",
    // Bloomreach Engagement (formerly Exponea — rebranded in 2022 but the
    // `exponea.com` infrastructure is still used by most tenants) hosts every
    // tenant's tracking edge on `cdn.<region>.exponea.com` with a per-tenant
    // path prefix:
    //   /<tenant-slug>/e/<base64url-token>/click  → click redirect
    //   /<tenant-slug>/e/<base64url-token>/open   → open-tracking pixel
    // Image / template assets are served from a Bloomreach-owned GCS bucket
    // at `storage.googleapis.com/<region>-app-storage/<tenant-uuid>/media/…`.
    // The `xnpe-attr="…"` attribute is emitted on every tracked anchor by the
    // Bloomreach email editor and is unique to this ESP. Brand-CNAMEd
    // tracking domains exist in the wild, so the URL-shape patterns below
    // carry the detection on their own when the host fingerprint won't fire.
    hostPatterns: [
      /(^|\.)exponea\.com$/i,
      /(^|\.)cdn\.[a-z0-9-]+\.exponea\.com$/i,
      /(^|\.)bloomreachengagement\.com$/i,
      /(^|\.)cdn\.[a-z0-9-]+\.bloomreach\.com$/i
    ],
    htmlPatterns: [
      /\bxnpe-attr\s*=\s*["']/i,
      /\bcdn\.[a-z0-9-]+\.exponea\.com\/[a-z0-9-]+\/e\/[A-Za-z0-9_.-]{20,}\/(?:click|open)\b/i,
      /\bcdn\.[a-z0-9-]+\.bloomreach\.com\/[a-z0-9-]+\/e\/[A-Za-z0-9_.-]{20,}\/(?:click|open)\b/i,
      /\bstorage\.googleapis\.com\/[a-z0-9-]+-app-storage\/[a-f0-9-]{16,}\/media\//i
    ],
    linkUrlPatterns: [
      /\bcdn\.[a-z0-9-]+\.exponea\.com\/[a-z0-9-]+\/e\/[A-Za-z0-9_.-]{20,}\/(?:click|open)\b/i,
      /\bcdn\.[a-z0-9-]+\.bloomreach\.com\/[a-z0-9-]+\/e\/[A-Za-z0-9_.-]{20,}\/(?:click|open)\b/i
    ],
    dkimPatterns: [/exponea\.com/i, /bloomreach\.com/i, /bloomreachengagement\.com/i],
    returnPathPatterns: [
      /exponea\.com/i,
      /bloomreach\.com/i,
      /bloomreachengagement\.com/i,
      /bounce[^@]*@[^>\s]*(?:exponea|bloomreach)/i
    ],
    xHeaderNames: [
      "x-exponea-message-id",
      "x-exponea-campaign-id",
      "x-exponea-customer-id",
      "x-bloomreach-message-id",
      "x-bloomreach-campaign-id"
    ]
  }
];

const SIGNAL_WEIGHT: Record<EspSignal["kind"], number> = {
  dkim_d: 0.55,
  return_path: 0.45,
  feedback_id: 0.45,
  list_unsubscribe: 0.4,
  x_header: 0.4,
  link_host: 0.35,
  link_url: 0.35,
  image_host: 0.25,
  html_marker: 0.2
};

const CONFIDENCE_THRESHOLD = 0.6;

const MAX_HTML_MARKERS_PER_PROVIDER = 4;

const MAX_LINK_URL_MATCHES_PER_PROVIDER = 2;

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
  const linkUrls = links
    .map((link) => link.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0);

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

    if (fp.linkUrlPatterns && linkUrls.length > 0) {
      let linkUrlMatchCount = 0;
      const seenLinkDetails = new Set<string>();
      for (const pattern of fp.linkUrlPatterns) {
        if (linkUrlMatchCount >= MAX_LINK_URL_MATCHES_PER_PROVIDER) {
          break;
        }
        const hit = linkUrls.find((url) => pattern.test(url));
        if (!hit) {
          continue;
        }
        const detail = hit.slice(0, 120);
        if (seenLinkDetails.has(detail)) {
          continue;
        }
        seenLinkDetails.add(detail);
        addSignal(fp.provider, { kind: "link_url", detail });
        linkUrlMatchCount += 1;
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
