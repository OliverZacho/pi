import { describe, expect, it } from "vitest";
import { detectEsp } from "@/lib/esp-detect";

function link(url: string) {
  const u = new URL(url);
  return {
    url,
    host: u.hostname.toLowerCase(),
    utm: { source: null, medium: null, campaign: null, content: null, term: null }
  };
}

describe("detectEsp", () => {
  it("identifies Mailchimp via list-manage tracking links and DKIM", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; a=rsa-sha256; d=mcsv.net; s=k1; c=relaxed/relaxed;",
        "List-Unsubscribe": "<https://brand.us1.list-manage.com/unsubscribe?u=abc&id=123>"
      },
      html: '<a href="https://brand.us1.list-manage.com/track/click?u=abc">click</a>',
      links: [link("https://brand.us1.list-manage.com/track/click?u=abc")]
    });
    expect(result.provider).toBe("mailchimp");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["dkim_d", "link_host"])
    );
  });

  it("identifies Klaviyo via tracking host and DKIM", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; a=rsa-sha256; d=email.klaviyomail.com; s=k1;",
        "Return-Path": "<bounces.klaviyo.com>"
      },
      html: '<a href="https://trk.klaviyomail.com/abc">click</a>',
      links: [link("https://trk.klaviyomail.com/abc")]
    });
    expect(result.provider).toBe("klaviyo");
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it("identifies Klaviyo via @import CSS URL plus kl- template classes (no <a> link, no DKIM headers)", () => {
    const html = `
      <html><head>
        <style>@import url(https://static-forms.klaviyo.com/fonts/api/v1/WJ7sXi/custom_fonts.css);</style>
      </head><body>
        <div class="kl-row colstack"><div class="kl-column">hi</div></div>
        <a href="https://brand.com/sale">Shop</a>
      </body></html>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [link("https://brand.com/sale")],
      resourceHosts: ["static-forms.klaviyo.com"]
    });
    expect(result.provider).toBe("klaviyo");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker"])
    );
  });

  it("identifies HubSpot via _hsenc/_hsmi link parameters", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=hubspotemail.net;"
      },
      html: '<a href="https://example.hs-sites.com/e?_hsenc=foo&_hsmi=42">click</a>',
      links: [link("https://example.hs-sites.com/e?_hsenc=foo&_hsmi=42")]
    });
    expect(result.provider).toBe("hubspot");
  });

  it("identifies SendGrid via DKIM and tracking link", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=sendgrid.net;",
        "Return-Path": "<bounces+99@sendgrid.net>"
      },
      links: [link("https://u123.ct.sendgrid.net/asm/123")]
    });
    expect(result.provider).toBe("sendgrid");
  });

  it("identifies Braze via SparkPost return-path", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=sparkpostmail1.com;",
        "Return-Path": "<msprvs1=12345=bounces-12345@sparkpostmail1.com>"
      },
      links: [link("https://e.brand.com/click?id=abc")]
    });
    expect(result.provider).toBe("braze");
  });

  it("identifies Iterable via campaign-id link parameter", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=iterable.com;"
      },
      html: '<a href="https://links.brand.iterable.com/click?iterableCampaignId=99">x</a>',
      links: [link("https://links.brand.iterable.com/click?iterableCampaignId=99")]
    });
    expect(result.provider).toBe("iterable");
  });

  it("identifies Customer.io", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=customeriomail.com;"
      },
      links: [link("https://track.customer.io/e/c/abc")]
    });
    expect(result.provider).toBe("customerio");
  });

  it("identifies Salesforce Marketing Cloud", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=exct.net;",
        "Return-Path": "<bounce.s7.exacttarget.com>"
      },
      links: [link("https://cl.s11.exct.net/?qs=abc")]
    });
    expect(result.provider).toBe("salesforce_mc");
  });

  it("identifies Marketo via mkt_tok parameter", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=mktdns.com;"
      },
      html: '<a href="https://info.brand.com/MzYwLVJVUC0xMjMAAAFx?mkt_tok=abc">x</a>',
      links: [link("https://info.brand.com/x?mkt_tok=abc")]
    });
    expect(result.provider).toBe("marketo");
  });

  it("identifies Omnisend", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=omnisend.com;"
      },
      links: [link("https://links.omnisend.com/click?u=abc")]
    });
    expect(result.provider).toBe("omnisend");
  });

  it("identifies ActiveCampaign", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=activehosted.com;",
        "Return-Path": "<bounce-1234@activehosted.com>"
      },
      links: [link("https://brand.activehosted.com/p_v.php?id=99")]
    });
    expect(result.provider).toBe("activecampaign");
  });

  it("identifies Constant Contact", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=constantcontact.com;",
        "Return-Path": "<bounces@in.constantcontact.com>"
      },
      links: [link("https://r20.rs6.net/tn.jsp?f=001abc")]
    });
    expect(result.provider).toBe("constantcontact");
  });

  it("identifies Drip", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=getdrip.com;"
      },
      links: [link("https://www.getdrip.com/c/abc")]
    });
    expect(result.provider).toBe("drip");
  });

  it("identifies Attentive", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=attentivemobile.com;"
      },
      links: [link("https://email.attentivemobile.com/click?id=abc")]
    });
    expect(result.provider).toBe("attentive");
  });

  it("identifies Shopify Email", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=shopifyemail.com;",
        "Return-Path": "<bounces.shopifyemail.com>"
      },
      links: [link("https://delivery.shopifyemail.com/click?u=abc")]
    });
    expect(result.provider).toBe("shopify_email");
  });

  it("identifies Substack via DKIM and tracking link", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=substack.com;"
      },
      links: [link("https://email.substack.com/c/abc")]
    });
    expect(result.provider).toBe("substack");
  });

  it("identifies beehiiv", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=mail.beehiiv.com;"
      },
      links: [link("https://mail.beehiiv.com/click?id=abc")]
    });
    expect(result.provider).toBe("beehiiv");
  });

  it("identifies ConvertKit / Kit", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=convertkit-mail2.com;"
      },
      links: [link("https://creator.convertkit-mail2.com/c/abc")]
    });
    expect(result.provider).toBe("convertkit");
  });

  it("identifies MailerLite", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=mlsend.com;",
        "Return-Path": "<bounces@mlsend.com>"
      },
      links: [link("https://email.mailerlite.com/click?u=abc")]
    });
    expect(result.provider).toBe("mailerlite");
  });

  it("identifies Mailgun", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=mailgun.org;",
        "Return-Path": "<bounces@brand.mailgun.org>"
      },
      links: [link("https://email.mailgun.net/o/abc")]
    });
    expect(result.provider).toBe("mailgun");
  });

  it("identifies Postmark", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=mtasv.net;",
        "Return-Path": "<msprvs1=12=bounces@pm-bounces.com>"
      },
      links: [link("https://pmrdy.com/track/click?u=abc")]
    });
    expect(result.provider).toBe("postmark");
  });

  it("identifies Amazon SES", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=amazonses.com;",
        "Return-Path": "<01000001-bounces@amazonses.com>"
      },
      html: "<a href=\"https://brand.com\">x</a>",
      links: [link("https://brand.com")]
    });
    expect(result.provider).toBe("amazon_ses");
  });

  it("identifies Mailjet", () => {
    const result = detectEsp({
      headers: {
        "DKIM-Signature": "v=1; d=mailjet.com;"
      },
      links: [link("https://x9z3p.mjt.lu/lnk/abc")]
    });
    expect(result.provider).toBe("mailjet");
  });

  it("identifies APSIS One via tr.apsis.one click links and aonetrk.com open pixel (no headers)", () => {
    const html = `
      <img src="https://tr.aonetrk.com/open/abc?pmc=xyz" width="1" height="1" />
      <img src="https://static.images.apsis.one/pixel.gif" />
      <a href="https://tr.apsis.one/e/uXB1jaobQESJMlvVkKXz0A/aaa/bbb/ccc"
         data-link-id="ln_abc123" target="_blank">Shop</a>
      <a href="https://tr.apsis.one/unsub/8O4J8NvHRU2Aw2keNm_wzA/ln_xkBi0LsGk3OED3je9cHSu">Unsubscribe</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://tr.apsis.one/e/uXB1jaobQESJMlvVkKXz0A/aaa/bbb/ccc"),
        link("https://tr.apsis.one/unsub/8O4J8NvHRU2Aw2keNm_wzA/ln_xkBi0LsGk3OED3je9cHSu")
      ],
      resourceHosts: [
        "tr.aonetrk.com",
        "static.images.apsis.one",
        "images.apsis.one",
        "tr.apsis.one"
      ]
    });
    expect(result.provider).toBe("apsis");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("returns unknown when there are no provider hints", () => {
    const result = detectEsp({
      headers: { "DKIM-Signature": "v=1; d=brand.com;" },
      html: "<p>Hello</p>",
      links: []
    });
    expect(result.provider).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("returns unknown when only one weak signal is present below the threshold", () => {
    const result = detectEsp({
      headers: {},
      html: '<a href="https://gallery.example.com/img.png">y</a>',
      links: [link("https://gallery.example.com/img.png")]
    });
    expect(result.provider).toBe("unknown");
  });
});
