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

  it("identifies Salesforce Marketing Cloud on a CNAMEd custom tracking domain (no headers)", () => {
    const html = `
      <img src="https://click.ros.rosendahl.com/open.aspx?D4QCRQAS3JHE5B6ZHEKFJNU6QM.510007&d=510007&bmt=0" width="1" height="1" />
      <table class="stylingblock-content-wrapper"><tr>
        <td class="stylingblock-content-wrapper camarker-inner">
          <a data-linkto="other" href="https://click.ros.rosendahl.com/?qs=ABB7InYiOjEsImQiOjQ4NzN9ADMAAAAAACJJ6OZ0G">Shop</a>
          <img data-assetid="85073" src="https://image.ros.rosendahl.com/lib/fe2e11737364047d701d75/m/1/SFMC_Logo_Header.png" />
        </td>
      </tr></table>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://click.ros.rosendahl.com/?qs=ABB7InYiOjEsImQiOjQ4NzN9ADMAAAAAACJJ6OZ0G")
      ],
      resourceHosts: [
        "click.ros.rosendahl.com",
        "image.ros.rosendahl.com"
      ]
    });
    expect(result.provider).toBe("salesforce_mc");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker"])
    );
  });

  it("identifies Salesforce Marketing Cloud with strong confidence on a real Rosendahl GWP email shape", () => {
    // Distilled from a real send: only HTML and parsed links, no DKIM /
    // Return-Path / x- headers available. The previous fingerprint matched at
    // exactly the threshold floor (3 × html_marker = 0.6), which was so
    // fragile that small template variations would flip the result to
    // `unknown`. With the URL-shape patterns ordered first plus a dedicated
    // `link_url` signal, real-world SFMC sends should now clear ~0.8+.
    const html = `
      <div style="font-size:0; line-height:0;"><img src="https://click.ros.rosendahl.com/open.aspx?FUWFCVEBYDBULMCYHJERMVT3RQ.510005&d=510005&bmt=0" width="1" height="1" alt=""></div>
      <table class="stylingblock-content-wrapper"><tr>
        <td class="stylingblock-content-wrapper camarker-inner">
          <a data-linkto="other" href="https://click.ros.rosendahl.com/?qs=ABB7InYiOjEsImQiOjQ4NzR9ADMAAAAAACS7hegxCwzriHzszn9AlpMozeqO7OX3oFsbyUAPRX0gqNCFPRt45iyihHj2BPFumxLV4Gclj3vEyNxN4hfX4p1AT0vD-9fef9zuaiGPaPt7Sg">Se denne email i en browser</a>
          <a data-linkto="other" href="https://click.ros.rosendahl.com/?qs=ABB7InYiOjEsImQiOjQ4NzR9ADMAAAAAACS7hegyNKaQc2mp80ysxG5VpyOKR96rGN25x3Ts1inO9DEKyK-w_NmCCp37urqUCgMS6yibjl_Yc8x_mGFs6FvymNcfzWvLokD6OaucDhS6PQ">Front page</a>
          <img data-assetid="14749" src="https://image.ros.rosendahl.com/lib/fe2e11737364047d701d75/m/1/18d2266d-da00-4f0e-9ce7-48fab00d6a77.png" alt="" />
          <img data-assetid="163126" src="https://image.ros.rosendahl.com/lib/fe2e11737364047d701d75/m/1/SS26_MULTIBRAND_GWP_NEWSLETTER_1200x12.jpg" alt="" />
        </td>
      </tr></table>
    `;
    const result = detectEsp({
      headers: null,
      html,
      links: [
        link("https://click.ros.rosendahl.com/?qs=ABB7InYiOjEsImQiOjQ4NzR9ADMAAAAAACS7hegxCwzriHzszn9AlpMozeqO7OX3oFsbyUAPRX0gqNCFPRt45iyihHj2BPFumxLV4Gclj3vEyNxN4hfX4p1AT0vD-9fef9zuaiGPaPt7Sg"),
        link("https://click.ros.rosendahl.com/?qs=ABB7InYiOjEsImQiOjQ4NzR9ADMAAAAAACS7hegyNKaQc2mp80ysxG5VpyOKR96rGN25x3Ts1inO9DEKyK-w_NmCCp37urqUCgMS6yibjl_Yc8x_mGFs6FvymNcfzWvLokD6OaucDhS6PQ")
      ],
      resourceHosts: [
        "click.ros.rosendahl.com",
        "image.ros.rosendahl.com"
      ]
    });
    expect(result.provider).toBe("salesforce_mc");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
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

  it("identifies ActiveCampaign via acemln*.com tracking subdomain (no headers)", () => {
    const html = `
      <a href="https://hubsch-interior.acemlnb.com/lt.php?x=41Zy~GE2J6PN5HV6">Shop</a>
      <a href="https://hubsch-interior.acemlnb.com/proc.php?nl=3&c=1416&m=1545&act=unsub&runid=393424">Unsubscribe</a>
      <a href="https://hubsch-interior.acemlnb.com/p_v.php?l=3&c=1416&m=1545">View online</a>
      <img src="https://hubsch-interior.acemlnb.com/lt.php?x=4TZy~GE2J6PN5HV6" width="1" height="1" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://hubsch-interior.acemlnb.com/lt.php?x=41Zy~GE2J6PN5HV6"),
        link("https://hubsch-interior.acemlnb.com/proc.php?nl=3&c=1416&m=1545&act=unsub&runid=393424"),
        link("https://hubsch-interior.acemlnb.com/p_v.php?l=3&c=1416&m=1545")
      ],
      resourceHosts: ["hubsch-interior.acemlnb.com"]
    });
    expect(result.provider).toBe("activecampaign");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker"])
    );
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

  it("identifies Agillic on a brand-CNAMEd tracking domain with the Agillic CDN (no headers)", () => {
    // Distilled from a real Bolia Velkomstflow send: the tracking / open /
    // web-view host is CNAMEd to `designuniverse.bolia.com`, so only the image
    // CDN host on `*.agilliccdn.com` matches by host. The URL-shape patterns
    // (`/api/api/webcopy/view/`, `/web/namedservice/?ext=`, `/web/open/`,
    // `/api/api/checker/click`, `/web/page/?pv=`) plus the Agillic Editor
    // markers (`agillicRangeMarker`, the `agavailability` meta tag, the
    // `data-webcopy-link` attribute) carry the detection.
    const html = `
      <html><head>
        <meta name="agavailability" content="email">
        <meta name="predefined-color" content="transparent,#F2F0E7,#69755F">
      </head><body>
        <img src="https://designuniverse.bolia.com/web/open/HROg4mtcRlSWpCFyK-aJi-PgSTmXlDAcW7DlccEgDe1tJyASniCQao8A18QQJOeW:Zl0XbAbmSCdITkj7_zOX9Q==/open.gif">
        <div data-webcopy-link="https://designuniverse.bolia.com/api/api/webcopy/view/1WNEsUTyqxSuYOPTcdFh6JPsleQCFi57odlh-glXNF4xmA6MjJVEOF9Pe3airjyj:pthcOkVwWG-0Ck70LxYndA==/Velkomstflow_Mail1_FY26.html?lgn_uid=foo" data-webcopy-label="Vis denne mail i webbrowser">
          <a href="https://designuniverse.bolia.com/api/api/webcopy/view/bVP4OdYwTY6sLnh28pMcR4k901OFb-ZnxcsPz3EMCzZRvVHkmJx8IF80XsgpKHzB:8pazYCjSexoaSFlYQoL_-A==/Velkomstflow_Mail1_FY26.html?lgn_uid=bar">View in browser</a>
          <a href="https://designuniverse.bolia.com/web/namedservice/?ext=https%3A%2F%2Fwww.bolia.com%2F%40%28local%29&cs=abc&lgn_uid=baz&ea=qux%3D%3D:r==">Shop</a>
          <a href="https://designuniverse.bolia.com/web/page/profile?pv=cnYCHDbl1zsfGruP-CHfbBb6FcXrLPFEQdrh6r-zZ8aAviXwWAdzJ8Fiv640Dwq-p2I1TkX7l8yxuUunoX3q8gzhQw7iHES1WUdk151R5NE=:foo==&ea=quux==">Update profile</a>
          <img src="https://bolia.agilliccdn.com/cpk7wt/MjAyNTA3/Mjk=/MDMwOGYzZTktNzE5Yi00M2FkLWJhM2UtNDFjNzQ0ZmY3ZGFm.jpg">
          <span class="agillicRangeMarker">&#8206;</span>
        </div>
        <a href="https://designuniverse.bolia.com/api/api/checker/click?ea=ELrz_9GVuUBUaP5kcL3itLGgVhUloW-P9cXo19YQ7kmJy_Qrl4A4RF_BTxTRnMid:R2jkRxOg56Yh5A2W2DvyRA==">Text</a>
      </body></html>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://designuniverse.bolia.com/api/api/webcopy/view/bVP4OdYwTY6sLnh28pMcR4k901OFb-ZnxcsPz3EMCzZRvVHkmJx8IF80XsgpKHzB:8pazYCjSexoaSFlYQoL_-A==/Velkomstflow_Mail1_FY26.html?lgn_uid=bar"),
        link("https://designuniverse.bolia.com/web/namedservice/?ext=https%3A%2F%2Fwww.bolia.com%2F%40%28local%29&cs=abc&lgn_uid=baz&ea=qux%3D%3D:r=="),
        link("https://designuniverse.bolia.com/web/page/profile?pv=cnYCHDbl1zsfGruP-CHfbBb6FcXrLPFEQdrh6r-zZ8aAviXwWAdzJ8Fiv640Dwq-p2I1TkX7l8yxuUunoX3q8gzhQw7iHES1WUdk151R5NE=:foo==&ea=quux=="),
        link("https://designuniverse.bolia.com/api/api/checker/click?ea=ELrz_9GVuUBUaP5kcL3itLGgVhUloW-P9cXo19YQ7kmJy_Qrl4A4RF_BTxTRnMid:R2jkRxOg56Yh5A2W2DvyRA==")
      ],
      resourceHosts: [
        "designuniverse.bolia.com",
        "bolia.agilliccdn.com"
      ]
    });
    expect(result.provider).toBe("agillic");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
    );
  });

  it("identifies Peytzmail on a tenant subdomain plus tracking URL shapes (no headers)", () => {
    // Distilled from a real TAKT welcome send. The tracking + web-view +
    // unsubscribe host is `<tenant>.peytzmail.com`, the image CDN is
    // `img.peytzmail.com`, and there's a shared static-asset bucket on
    // `peytzmail.s3.amazonaws.com`. The URL-shape patterns also carry the
    // detection if a customer ever points a brand CNAME at Peytzmail.
    const html = `
      <a href="https://taktcph.peytzmail.com/c/axt/6a07454bd82488c8968ecd77/izfbkj/header-logo-image/1814546243?t=https%3A%2F%2Ftaktcph.com%2F">
        <img src="https://taktcph.peytzmail.com/r/6a07454bd82488c8968ecd77/izfbkj/3729378504?t=https%3A%2F%2Fimg.peytzmail.com%2Fimage%2Fupload%2Flogo.png" />
      </a>
      <img src="https://img.peytzmail.com/image/upload/c_lfill,h_400,q_auto,w_325/v1554135643/taktcph/forrest-tduablctcwlvxvaeoclu.jpg" />
      <a href="https://taktcph.peytzmail.com/c/jua/6a07454bd82488c8968ecd77/izfbkj/article-title/4133251808?t=https%3A%2F%2Ftaktcph.com%2Fliving-responsibly%2F">100% Eco-Certified</a>
      <img src="https://peytzmail.s3.amazonaws.com/taktcph/images/black_arrow.png" />
      <a href="https://taktcph.peytzmail.com/v/6a07454bd82488c8968ecd77/izfbkj/0840583223/send">Read Online</a>
      <a href="https://taktcph.peytzmail.com/unsubscribe/6a07454bd82488c8968ecd77/2704248890?email=takt-20260515%40pirol.app">Unsubscribe</a>
      <img src="https://taktcph.peytzmail.com/r/6a07454bd82488c8968ecd77/izfbkj/1190018407?f=t&amp;t=spacer.gif" width="1" height="1" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://taktcph.peytzmail.com/c/axt/6a07454bd82488c8968ecd77/izfbkj/header-logo-image/1814546243?t=https%3A%2F%2Ftaktcph.com%2F"),
        link("https://taktcph.peytzmail.com/c/jua/6a07454bd82488c8968ecd77/izfbkj/article-title/4133251808?t=https%3A%2F%2Ftaktcph.com%2Fliving-responsibly%2F"),
        link("https://taktcph.peytzmail.com/v/6a07454bd82488c8968ecd77/izfbkj/0840583223/send"),
        link("https://taktcph.peytzmail.com/unsubscribe/6a07454bd82488c8968ecd77/2704248890?email=takt-20260515%40pirol.app")
      ],
      resourceHosts: [
        "taktcph.peytzmail.com",
        "img.peytzmail.com",
        "peytzmail.s3.amazonaws.com"
      ]
    });
    expect(result.provider).toBe("peytzmail");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
    );
  });

  it("identifies Peytzmail on a brand-CNAMEd tracking host using only URL shapes", () => {
    // If a customer points e.g. `email.brand.com` at Peytzmail, the host
    // patterns won't match — the `/c/<id>/<hash>/<token>/<context>/<id>?t=`,
    // `/r/<hash>/<token>/<id>?t=` and `/unsubscribe/<hash>/<id>?email=`
    // shapes still let us recognise the send.
    const html = `
      <a href="https://email.brand.com/c/axt/6a07454bd82488c8968ecd77/izfbkj/header-logo-image/1814546243?t=https%3A%2F%2Fbrand.com%2F">Logo</a>
      <a href="https://email.brand.com/c/jua/6a07454bd82488c8968ecd77/izfbkj/article-title/4133251808?t=https%3A%2F%2Fbrand.com%2Farticle%2F">Title</a>
      <img src="https://email.brand.com/r/6a07454bd82488c8968ecd77/izfbkj/1190018407?f=t&amp;t=spacer.gif" />
      <a href="https://email.brand.com/unsubscribe/6a07454bd82488c8968ecd77/2704248890?email=foo%40bar.com">Unsubscribe</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://email.brand.com/c/axt/6a07454bd82488c8968ecd77/izfbkj/header-logo-image/1814546243?t=https%3A%2F%2Fbrand.com%2F"),
        link("https://email.brand.com/c/jua/6a07454bd82488c8968ecd77/izfbkj/article-title/4133251808?t=https%3A%2F%2Fbrand.com%2Farticle%2F"),
        link("https://email.brand.com/unsubscribe/6a07454bd82488c8968ecd77/2704248890?email=foo%40bar.com")
      ],
      resourceHosts: ["email.brand.com"]
    });
    expect(result.provider).toBe("peytzmail");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
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
