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

  it("identifies Klaviyo via the new ctrk.klclick.com tracker, ULID-shaped /l/01<26> tokens, and kl-* editor classes (no headers)", () => {
    // Distilled from a real Filippa K welcome send. Klaviyo rolled out a new
    // click/open tracking edge in 2024-2025 on `ctrk.klclick.com`, with
    // ULID-shaped tokens (`/l/01<26-char>` for clicks and `/o/01<26-char>`
    // for the open pixel). Modern Klaviyo emails no longer include the
    // literal substring "klaviyo" anywhere in the rendered body — detection
    // therefore has to lean on the tracker host + URL-shape + editor class
    // markers (kl-row, kl-column, kl-button, hlb-wrapper, etc.) on their own.
    const html = `
      <img src="https://ctrk.klclick.com/o/01KSDRR5A3KQS23S0ADQW8CQ4Z" alt="" width="1" height="1" />
      <div class="kl-row colstack">
        <div class="kl-column">
          <div class="hlb-wrapper">
            <a class="kl-img-link" href="https://ctrk.klclick.com/l/01KSDRR5A3KQS23S0ADQW8CQ4Z_0">
              <img src="https://d3k81ch9hvuctc.cloudfront.net/company/U4c5dT/images/66c0fdd5-981d-46c5-ae2c-efe794603c6e.png" />
            </a>
            <a class="kl-button" href="https://ctrk.klclick.com/l/01KSDRR5A3KQS23S0ADQW8CQ4Z_24">Shop Now</a>
            <table class="kl-table-subblock"><tr><td class="kl-img-base-auto-width">x</td></tr></table>
          </div>
        </div>
      </div>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://ctrk.klclick.com/l/01KSDRR5A3KQS23S0ADQW8CQ4Z_0"),
        link("https://ctrk.klclick.com/l/01KSDRR5A3KQS23S0ADQW8CQ4Z_24")
      ],
      resourceHosts: ["ctrk.klclick.com", "d3k81ch9hvuctc.cloudfront.net"]
    });
    expect(result.provider).toBe("klaviyo");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
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

  it("identifies Braze via the braze-images.com asset CDN and utm_source=braze (no headers)", () => {
    // Distilled from a real ALO Yoga send. Braze wraps clicks through a
    // SendGrid CNAME on a brand domain (`click.emails.aloyoga.com/uni/ls/click?upn=…`),
    // so the tracking links carry no Braze fingerprint at all. Detection
    // leans on the `braze-images.com/appboy/communication/assets/…` CDN
    // (used for both images and @font-face webfonts) and the
    // `utm_source=braze` convention in direct links.
    const html = `
      <style>@font-face {
        font-family: "Proximanova Regular";
        src: url('https://braze-images.com/appboy/communication/assets/font_assets/files/698a818e1b4ecf0063119258/original.woff2?1770684814') format("woff2");
      }</style>
      <!--[if mso]><v:roundrect href="https://www.aloyoga.com/collections/new-arrivals?lid=jmcuhtrc55s4&utm_source=braze&utm_medium=email&utm_campaign=mktg-gen_nonpurch_f_srr-new-in-genpop_engaged_6.9.2026_x_x"><![endif]-->
      <a href="https://click.emails.aloyoga.com/uni/ls/click?upn=u001.QV1314xvOzHBMZTXVbujrMm6kdsH41jKl0JcCKercSQnuiziM88a4QRoPcRuatNX">
        <img src="https://braze-images.com/appboy/communication/assets/image_assets/images/683d8de7b7fc7a00660caee4/original.jpg?1748864486" alt="ALO" width="600" />
      </a>
      <img src="https://click.emails.aloyoga.com/wf/open?upn=u001.EMh8U-2Bet7f52HIpnSctWlAgHLYQuWsRvWd8v5hbp3wrg" alt="" width="1" height="1" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://click.emails.aloyoga.com/uni/ls/click?upn=u001.QV1314xvOzHBMZTXVbujrMm6kdsH41jKl0JcCKercSQnuiziM88a4QRoPcRuatNX"
        )
      ],
      resourceHosts: ["braze-images.com", "click.emails.aloyoga.com"]
    });
    expect(result.provider).toBe("braze");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker"])
    );
  });

  it("identifies Braze via cdn.braze.eu asset CDN and brand-CNAMEd /f/a/...~~/...~/... click tracker (no headers)", () => {
    // Distilled from a real Charlotte Tilbury send. Braze EU-cluster tenants
    // serve assets from `cdn.braze.eu/appboy/communication/assets/…` (not the
    // US `braze-images.com` CDN), and many of them route clicks through
    // Braze's own brand-CNAMEd tracker at
    // `clicks.<brand>.com/f/a/<token>~~/<hash>~/<base64-payload>` with the
    // open pixel at `/q/<token>~~/...~/...` instead of the SendGrid wrapper.
    // The `~~/` + `~/` separator combo across three base64url segments is a
    // Braze-only URL shape.
    const html = `
      <a href="https://clicks.charlottetilbury.com/f/a/XEb3iMSlDn8RSvh9Qu3sjw~~/AAAHahA~/YlOclDZLB7hNw7MjeJB5DDbtziYe_2gzF7Q2Lkbc1yBnPCpWkMnDdzB52C7dYuzC4RH_EgO5ipt">
        <img src="https://cdn.braze.eu/appboy/communication/assets/image_assets/images/6a27dd544f49c0008f470d6e/original.png?1780997459" alt="" />
      </a>
      <img border="0" width="1" height="1" alt="" src="https://clicks.charlottetilbury.com/q/2uHtBOYEu98Al9NIDBMQ9Q~~/AAAHahA~/_b9B-wu7bH7vNyXGRS1oDHEMxpbKSr2dK3OgaryiKWw4KzxDIgG372Pc9vPBPVROvogsE375nPPKbA8ajFvaAF6owZd9GPaLC5kXkeeTjso" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://clicks.charlottetilbury.com/f/a/XEb3iMSlDn8RSvh9Qu3sjw~~/AAAHahA~/YlOclDZLB7hNw7MjeJB5DDbtziYe_2gzF7Q2Lkbc1yBnPCpWkMnDdzB52C7dYuzC4RH_EgO5ipt"
        )
      ],
      resourceHosts: ["cdn.braze.eu", "clicks.charlottetilbury.com"]
    });
    expect(result.provider).toBe("braze");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
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

  it("identifies ActiveCampaign on a brand-CNAMEd tracking domain using URL shapes (no headers)", () => {
    // Distilled from a real Mater Design send. The tracking + unsubscribe +
    // web-view host is CNAMEd to `news.materdesign.com`, so the original
    // host-anchored HTML patterns never fire. The `lt.php?x=…` click tracker,
    // `proc.php?…&act=unsub&runid=…` unsubscribe processor and
    // `/content/<TENANT>/<YYYY>/<MM>/<DD>/<uuid>` content-asset URL shapes
    // (including Cloudflare's `/cdn-cgi/image/.../content/…` wrapper that AC
    // enables on custom tracking domains) carry the detection. One image
    // still loads directly from `<tenant>.activehosted.com`, providing the
    // host-pattern signal.
    const html = `
      <a target="_blank" href="https://news.materdesign.com/lt.php?x=41Zy~GDGJaHPDK4u__PKh.Oc3KIjiwTvlecwZHY4JFOaE5Ws-0y.z.lv5XUomN~2nuowY.I5k3eZUs.8.Q_7UeNv2e3m-ND">
        <img src="https://materdesign.activehosted.com/content/G7EEMP/2025/05/01/68fc6a23-876c-4669-bb65-2fd63d5b6234.png" height="30" />
      </a>
      <a target="_blank" href="https://news.materdesign.com/lt.php?x=41Zy~GDGJaHPDK4u__PKh.Oc3KIjiwTvlecwZHY4JFOaE5Ws-0y.z.lv5XUomN~2nuowXuI5k3eZUs.8.Q_7UeNv2e3m-ND">
        <img src="https://news.materdesign.com/cdn-cgi/image/format=auto,onerror=redirect,width=650,dpr=2,fit=scale-down/content/G7EEMP/2026/04/28/5d840283-e507-4249-b9d0-29453563145b.png" width="580" />
      </a>
      <a target="_blank" href="https://news.materdesign.com/proc.php?nl=18&c=94&m=98&s=34afbaed95d3a8f33f182195c731e9cc&act=unsub&runid=2345">unsubscribe</a>
      <img src="https://news.materdesign.com/lt.php?x=4TZy~GDGJaHPDK4u__PKh.Oc3KIjiwTvlecwZHY4JFOaE5Ws-02DjFJs3O3T-dfy_xIhZHl2VeKg5w41NAoFhR7cEu2i" width="1" height="1" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://news.materdesign.com/lt.php?x=41Zy~GDGJaHPDK4u__PKh.Oc3KIjiwTvlecwZHY4JFOaE5Ws-0y.z.lv5XUomN~2nuowY.I5k3eZUs.8.Q_7UeNv2e3m-ND"),
        link("https://news.materdesign.com/lt.php?x=41Zy~GDGJaHPDK4u__PKh.Oc3KIjiwTvlecwZHY4JFOaE5Ws-0y.z.lv5XUomN~2nuowXuI5k3eZUs.8.Q_7UeNv2e3m-ND"),
        link("https://news.materdesign.com/proc.php?nl=18&c=94&m=98&s=34afbaed95d3a8f33f182195c731e9cc&act=unsub&runid=2345")
      ],
      resourceHosts: [
        "materdesign.activehosted.com",
        "news.materdesign.com"
      ]
    });
    expect(result.provider).toBe("activecampaign");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
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

  it("identifies Peytzmail when the tenant uses short lowercase tokens instead of hex hashes (no headers)", () => {
    // Distilled from a real REMA 1000 send. This tenant's tracking URLs use
    // short lowercase tokens (`fdftfn`, `gfltdh`) where other tenants emit
    // 24-hex hashes — the URL structure (`/c/<3>/<tok>/<tok>/<context>/<id>?t=`,
    // `/r/…?f=t&t=spacer.gif`, `/v/…/send`, `/unsubscribe/…?email=`) is
    // otherwise identical. Previously the hex-only patterns missed this and
    // the email scored 0.55 (host + html marker), just under the threshold.
    const html = `
      <a href="https://rema1000.peytzmail.com/v/fdftfn/gfltdhkggh/3998848200/send">Vis i din browser</a>
      <a href="https://rema1000.peytzmail.com/c/yvq/fdftfn/gfltdh/image/3355613612?t=https%3A%2F%2Fwww.rema1000.dk%2F">
        <img src="https://rema1000.peytzmail.com/r/fdftfn/gfltdh/3796056549?t=https%3A%2F%2Fimg.peytzmail.com%2Fimage%2Fupload%2Fv1715690764%2Frema1000%2Frema1000-logo.png" alt="Logo" />
      </a>
      <a href="https://rema1000.peytzmail.com/c/ynt/fdftfn/gfltdh/article-button/0988391450?t=https%3A%2F%2Frema1000.dk%2Favis%2FLmz4YPPE%2F24">Find opskriften i avisen</a>
      <a href="https://rema1000.peytzmail.com/unsubscribe/fdftfn/2681455367?email=rema1000-20260522%40pirol.app">Afmeld nyhedsbrev</a>
      <img src="https://rema1000.peytzmail.com/r/fdftfn/gfltdh/1699260882?f=t&amp;t=spacer.gif" width="1" height="1" border="0" alt="">
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://rema1000.peytzmail.com/v/fdftfn/gfltdhkggh/3998848200/send"),
        link(
          "https://rema1000.peytzmail.com/c/yvq/fdftfn/gfltdh/image/3355613612?t=https%3A%2F%2Fwww.rema1000.dk%2F"
        ),
        link(
          "https://rema1000.peytzmail.com/c/ynt/fdftfn/gfltdh/article-button/0988391450?t=https%3A%2F%2Frema1000.dk%2Favis%2FLmz4YPPE%2F24"
        ),
        link(
          "https://rema1000.peytzmail.com/unsubscribe/fdftfn/2681455367?email=rema1000-20260522%40pirol.app"
        )
      ],
      resourceHosts: [
        "rema1000.peytzmail.com",
        "img.peytzmail.com",
        "webfonts.peytzmail.com"
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

  it("identifies Pure360 / Spotler on a brand-CNAMEd tracking host with the emlfiles4 image CDN (no headers)", () => {
    // Distilled from a real Georg Jensen "Weft" send. The tracking + open +
    // unsubscribe + view-in-browser host is CNAMEd to `email.georgjensen.com`,
    // so only the campaign image CDN host on `i.emlfiles4.com` matches by
    // host. The URL-shape patterns (`/c/AQ...`, `/cr/AQ...`, `/uns/AQ...`,
    // `/o/AQ.../o.gif`) plus the Easy Editor markers (`ee-template-version`,
    // `ee_responsive_campaign`, `ee_dropzone`, `ved_product_element`) carry
    // the detection.
    const html = `
      <html>
        <head><title>Vi præsenterer: Weft kollektionen</title></head>
        <body>
          <table class="ee_responsive_campaign" ee-template-version="8.4">
            <tr><td>
              <div class="ee_dropzone">
                <img src="https://i.emlfiles4.com/cmpimg/3/7/3/9/1/2/files/1909605_logo.png" alt="">
                <a href="https://email.georgjensen.com/c/AQjsohQQ2cymAxj1gOCDASCu2IIhKO25lREw8dgcmSqJQCBojgGqdoXohqpKDISMaQrbY7OX1KtCjzaYsKs">Shop</a>
                <table class="ved_product_element"><tr><td>Product</td></tr></table>
                <a href="https://email.georgjensen.com/cr/AQjsohQQ2cymAxj1gOCDATDtuZURdPk0FYOzMYFgEoyv34nek2sKza-4ihFUZDDr_mCannc">View in browser</a>
                <a href="https://email.georgjensen.com/uns/AQjsohQQ2cymAxj1gOCDASDtuZURnb3hud5O-jQoOwyu4dCTkHkwuQ6pvtiGHKup4nZREr4">Unsubscribe</a>
                <img src="https://email.georgjensen.com/o/AQjsohQQ2cymAxj1gOCDASABKO25lREw8dgcOS_OH5cdwh2NOSAKouohzyfaF5PoWC7oPuKo8G36c_k/o.gif" width="1" height="1">
              </div>
            </td></tr>
          </table>
        </body>
      </html>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://email.georgjensen.com/c/AQjsohQQ2cymAxj1gOCDASCu2IIhKO25lREw8dgcmSqJQCBojgGqdoXohqpKDISMaQrbY7OX1KtCjzaYsKs"
        ),
        link(
          "https://email.georgjensen.com/cr/AQjsohQQ2cymAxj1gOCDATDtuZURdPk0FYOzMYFgEoyv34nek2sKza-4ihFUZDDr_mCannc"
        ),
        link(
          "https://email.georgjensen.com/uns/AQjsohQQ2cymAxj1gOCDASDtuZURnb3hud5O-jQoOwyu4dCTkHkwuQ6pvtiGHKup4nZREr4"
        )
      ],
      resourceHosts: ["email.georgjensen.com", "i.emlfiles4.com"]
    });
    expect(result.provider).toBe("pure360");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
    );
  });

  it("identifies Pure360 / Spotler on a brand-CNAMEd tracking host using only URL shapes", () => {
    // If a customer points e.g. `mail.brand.com` at Pure360 AND uploads
    // their images to their own CDN (so the `i.emlfiles4.com` host doesn't
    // appear), the `/c/AQ`, `/cr/AQ`, `/uns/AQ`, `/o/AQ.../o.gif` token
    // shapes still let us recognise the send.
    const html = `
      <a href="https://mail.brand.com/c/AQabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV">Shop</a>
      <a href="https://mail.brand.com/cr/AQabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV">View in browser</a>
      <a href="https://mail.brand.com/uns/AQabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV">Unsubscribe</a>
      <img src="https://mail.brand.com/o/AQabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV/o.gif" width="1" height="1">
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://mail.brand.com/c/AQabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV"
        ),
        link(
          "https://mail.brand.com/cr/AQabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV"
        ),
        link(
          "https://mail.brand.com/uns/AQabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV"
        )
      ],
      resourceHosts: ["mail.brand.com"]
    });
    expect(result.provider).toBe("pure360");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies HeyLoyalty on its public/app/img.heyloyalty.com subdomains plus tracking URL shapes (no headers)", () => {
    // Distilled from a real ARoS Aarhus Kunstmuseum welcome send. HeyLoyalty
    // hosts the click-redirect + open pixel on `public.heyloyalty.com`, the
    // web-view + unsubscribe on `app.heyloyalty.com`, and the image CDN on
    // `img.heyloyalty.com`. The `/redirectclick?tt=…&l=…&msgid=…&m=<uuid>`
    // query-string shape, the `/track/<list>/<uuid>/<channel>/<tt>/<msgid>`
    // open pixel path, and the `/unsubscribe/<hash>/a<list>m<msg>` slug are
    // all HeyLoyalty-only.
    const html = `
      <img src="https://public.heyloyalty.com/track/19737/d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd/autoresponder/1779260065.2159/1919301" width="3" height="3" />
      <a href="https://public.heyloyalty.com/redirectclick?tt=1779260065.2159&amp;l=InfWr&amp;msgid=1919301&amp;m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&amp;url=https://www.aros.dk/da/" data-uid="InfWr">
        <img src="https://img.heyloyalty.com/heyloyalty1/filemanager/abc/def.gif" alt="ARoS" />
      </a>
      <a href="https://public.heyloyalty.com/redirectclick?tt=1779260065.2159&amp;l=nx301&amp;msgid=1919301&amp;m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&amp;url=https://www.aros.dk/da/besoeg/aarskort/" data-uid="nx301">Se alle dine medlemsfordele her</a>
      <a href="https://public.heyloyalty.com/redirectclick?tt=1779260065.2159&amp;l=OVE6c&amp;msgid=1919301&amp;m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&amp;url=app.heyloyalty.com/unsubscribe/ZXlKcGRpSTZJbFpSZVVaM01YRkZUWEZuZDJKNU9HdG1XVkpJZDFFOVBTSXM/a19737m1919301">Afmeld nyhedsbrev</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://public.heyloyalty.com/redirectclick?tt=1779260065.2159&l=InfWr&msgid=1919301&m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&url=https://www.aros.dk/da/"),
        link("https://public.heyloyalty.com/redirectclick?tt=1779260065.2159&l=nx301&msgid=1919301&m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&url=https://www.aros.dk/da/besoeg/aarskort/"),
        link("https://public.heyloyalty.com/redirectclick?tt=1779260065.2159&l=OVE6c&msgid=1919301&m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&url=app.heyloyalty.com/unsubscribe/ZXlKcGRpSTZJbFpSZVVaM01YRkZUWEZuZDJKNU9HdG1XVkpJZDFFOVBTSXM/a19737m1919301")
      ],
      resourceHosts: [
        "public.heyloyalty.com",
        "img.heyloyalty.com"
      ]
    });
    expect(result.provider).toBe("heyloyalty");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
    );
  });

  it("identifies HeyLoyalty via the redirectclick URL shape on a brand-CNAMEd tracking host (no headers)", () => {
    // If a customer ever points e.g. `mail.brand.com` at HeyLoyalty's tracking
    // edge, the host fingerprints won't match — the
    // `/redirectclick?tt=…&l=…&msgid=…&m=<uuid>` query-string shape still
    // carries the detection on its own (html_marker + link_url).
    const html = `
      <a href="https://mail.brand.com/redirectclick?tt=1779260065.2159&amp;l=InfWr&amp;msgid=1919301&amp;m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&amp;url=https://brand.com/" data-uid="InfWr">Shop</a>
      <a href="https://mail.brand.com/redirectclick?tt=1779260065.2160&amp;l=nx301&amp;msgid=1919301&amp;m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&amp;url=https://brand.com/sale/" data-uid="nx301">Sale</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link("https://mail.brand.com/redirectclick?tt=1779260065.2159&l=InfWr&msgid=1919301&m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&url=https://brand.com/"),
        link("https://mail.brand.com/redirectclick?tt=1779260065.2160&l=nx301&msgid=1919301&m=d04ab7fc-83f4-4b92-a9b0-6c77aeb68ebd&url=https://brand.com/sale/")
      ],
      resourceHosts: ["mail.brand.com"]
    });
    expect(result.provider).toBe("heyloyalty");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Bloomreach Engagement (Exponea) via cdn.<region>.exponea.com tracking links and the xnpe-attr marker (no headers)", () => {
    // Distilled from a real GANNI welcome send. Bloomreach Engagement
    // (formerly Exponea) hosts every tenant's tracking edge on
    // `cdn.<region>.exponea.com` with the per-tenant
    // `/<tenant>/e/<base64url-token>/click` and `…/open` paths, serves images
    // from a Bloomreach-owned GCS bucket at
    // `storage.googleapis.com/<region>-app-storage/<tenant-uuid>/media/…`,
    // and emits the `xnpe-attr` attribute on tracked anchors — none of which
    // are used by any other ESP we fingerprint.
    const html = `
      <a href="https://cdn.eu1.exponea.com/ganni-prod/e/CgxqDLCtTy8BRiWUE5wSIEb8xbJoTPc4p0nBTH67BJ4TGq3OM0CJJohoKEJMKtTaKgJkYTHU8HXNJoXaQWoMZN4QYafhPxtI37NjyAEB0gEhCg5jX3dlbGNvbWVfY29kZRIPQkszLVpWVC1CTEgtUEdHgAIE.53NCDwcfeyOk-Q/click" xnpe-attr="notextnorew">
        <img width="1" height="1" alt="" src="https://cdn.eu1.exponea.com/ganni-prod/e/CgxqDLCtTy8BRiWUE5wSIEb8xbJoTPc4p0nBTH67BJ4TGq3OM0CJJohoKEJMKtTaKgJkYTHU8HXNJoXaQWoMZN4QYafhPxtI37Nj0gEhCg5jX3dlbGNvbWVfY29kZRIPQkszLVpWVC1CTEgtUEdHgAIE.IfetC8u5Dv2_GQ/open" />
      </a>
      <img src="https://storage.googleapis.com/eu1-app-storage/c5ed97c0-0ab3-11ee-aa4b-2284982d3421/media/original/89fbf362-93f8-11f0-9f9c-fa777b398903" alt="GANNI" />
      <a href="https://cdn.eu1.exponea.com/ganni-prod/e/.eJwTUnD7c3RThs93i-WeB33qdrPME5Zae87YoVOtI0PDyUfryi0p0YySkoJiK331234567890abcdef.27IjlQODUwVvEw/click" target="_blank">Shop T-Shirts</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://cdn.eu1.exponea.com/ganni-prod/e/CgxqDLCtTy8BRiWUE5wSIEb8xbJoTPc4p0nBTH67BJ4TGq3OM0CJJohoKEJMKtTaKgJkYTHU8HXNJoXaQWoMZN4QYafhPxtI37NjyAEB0gEhCg5jX3dlbGNvbWVfY29kZRIPQkszLVpWVC1CTEgtUEdHgAIE.53NCDwcfeyOk-Q/click"
        ),
        link(
          "https://cdn.eu1.exponea.com/ganni-prod/e/.eJwTUnD7c3RThs93i-WeB33qdrPME5Zae87YoVOtI0PDyUfryi0p0YySkoJiK331234567890abcdef.27IjlQODUwVvEw/click"
        )
      ],
      resourceHosts: [
        "cdn.eu1.exponea.com",
        "storage.googleapis.com"
      ]
    });
    expect(result.provider).toBe("exponea");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
    );
  });

  it("identifies Bloomreach Engagement (Exponea) routed through a brand-CNAMEd tracking host via the /e/<token>/click|open URL shape + xnpe-attr (no headers)", () => {
    // Distilled from a real Acne Studios send. Bloomreach Engagement lets
    // tenants CNAME a brand domain (here `link.acnestudios.com`) at the
    // tracking edge, so none of the `cdn.<region>.exponea.com` host
    // fingerprints fire. Detection rides on the host-agnostic
    // `/<tenant>/e/<base64url-token>/click` + `…/open` path pair plus the
    // `xnpe-attr` attribute emitted on every tracked anchor.
    const html = `
      <a href="https://link.acnestudios.com/acnestudios-prod/e/.eJzj4smSaPr772BlVZB8_UEhBZHsXKaFfOuYNJ-ZC8x2ijG8ui9Vrs2Ws4vhSPXcKWV3XAwDM5TPLO645ZjFk5nevrg7fk7wioXu008wMl5ilODiTY4vT00qzixJjS9KLBdiT0zOS41Pyb7EKMLFCZdCEhbi4kmOz8lPTsyBaGBKzbvEyMfFAROECAhwcQEFEvPSSxPTwUINTIwAP4dBgA.rvTze01UsD2U5Q/click" xnpe-attr="notextnorew">
        <img width="1" height="1" alt="" src="https://link.acnestudios.com/acnestudios-prod/e/.eJzj4smSaPr772BlVZB8_UEhBZHsXKaFfOuYNJ-ZC8x2ijG8ui9Vrs2Ws4vhSPXcKWV3XAwDM5TPLO645ZjFk5nevrg7fk7wioXu0y8xSnDxJseXpyYVZ5akxhcllguxJybnpcanZF9iFOHihEshCQtx8STH5-QnJ-ZANDCl5l1i5OPigAlCBAS4uIACiXnppYnpYKEGJkYAjSBAtg.aKIihKzugqU4IQ/open" style="display: none;" />
      </a>
      <a href="https://link.acnestudios.com/acnestudios-prod/e/.eJwTUhDJzmVayLeOSfOZucBspxjDq_tS5dpsObsYjlTPnVJ2x0VKOqOkpKDYSl-_vLxcLzE5L7W4pDQlM79YLzk_1zAwQ.2amtuVdTxa9P4w/click" target="_blank">ACNESTUDIOS.COM</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://link.acnestudios.com/acnestudios-prod/e/.eJzj4smSaPr772BlVZB8_UEhBZHsXKaFfOuYNJ-ZC8x2ijG8ui9Vrs2Ws4vhSPXcKWV3XAwDM5TPLO645ZjFk5nevrg7fk7wioXu008wMl5ilODiTY4vT00qzixJjS9KLBdiT0zOS41Pyb7EKMLFCZdCEhbi4kmOz8lPTsyBaGBKzbvEyMfFAROECAhwcQEFEvPSSxPTwUINTIwAP4dBgA.rvTze01UsD2U5Q/click"
        ),
        link(
          "https://link.acnestudios.com/acnestudios-prod/e/.eJwTUhDJzmVayLeOSfOZucBspxjDq_tS5dpsObsYjlTPnVJ2x0VKOqOkpKDYSl-_vLxcLzE5L7W4pDQlM79YLzk_1zAwQ.2amtuVdTxa9P4w/click"
        )
      ],
      resourceHosts: ["link.acnestudios.com"]
    });
    expect(result.provider).toBe("exponea");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Voyado on its <tenant>.customer.eclub.se host plus /link/<id>/a/ and /open/email/online URL shapes (no headers)", () => {
    // Distilled from a real Samsøe Samsøe welcome send. Voyado Engage
    // (formerly "Apptus eSales eClub") hosts every tenant on
    // `<tenant>.customer.eclub.se` for click redirects, the web-view link,
    // and unsubscribes; image assets live on `images.eclub.se` (legacy) and
    // `cdn.voyado.com` (rebranded). The `/link/<id>/a/<id>/<id>/<id>/<id>/<id>`
    // click-redirect chain, the `/open/email/online/<id>/<id>/<id>` web-view
    // path, and the `/open/subscription/unsubscribe/<id>/<id>` slug are all
    // Voyado-only.
    const html = `
      <a href="https://samsoe.customer.eclub.se/open/email/online/ymMiURehkEKnXLRWALAd7A/gpz5roDnmUasvrRWAI8nqA/5-38pXLvC0Seg7RWALAd7A">View in Browser</a>
      <a href="https://samsoe.customer.eclub.se/link/r3XcV0QSDEeA1rRWAI8oyQ/a/iRw4F3eWUEeXZYZprHjFxw/ymMiURehkEKnXLRWALAd7A/gpz5roDnmUasvrRWAI8nqA/5-38pXLvC0Seg7RWALAd7A/c2Ftc29l">
        <img src="https://images.eclub.se/images/samsoesamsoe/logo_new.png" alt="Logo" />
      </a>
      <img src="https://cdn.voyado.com/images/samsoe/9def2e3fb7624de29839b3e800dbf4b4.1BA07D39A8D3CF7CF1A5638D33988CAA0A16D482.jpg" />
      <a href="https://samsoe.customer.eclub.se/open/subscription/unsubscribe/ymMiURehkEKnXLRWALAd7A/gpz5roDnmUasvrRWAI8nqA">Unsubscribe</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://samsoe.customer.eclub.se/open/email/online/ymMiURehkEKnXLRWALAd7A/gpz5roDnmUasvrRWAI8nqA/5-38pXLvC0Seg7RWALAd7A"
        ),
        link(
          "https://samsoe.customer.eclub.se/link/r3XcV0QSDEeA1rRWAI8oyQ/a/iRw4F3eWUEeXZYZprHjFxw/ymMiURehkEKnXLRWALAd7A/gpz5roDnmUasvrRWAI8nqA/5-38pXLvC0Seg7RWALAd7A/c2Ftc29l"
        ),
        link(
          "https://samsoe.customer.eclub.se/open/subscription/unsubscribe/ymMiURehkEKnXLRWALAd7A/gpz5roDnmUasvrRWAI8nqA"
        )
      ],
      resourceHosts: [
        "samsoe.customer.eclub.se",
        "images.eclub.se",
        "cdn.voyado.com"
      ]
    });
    expect(result.provider).toBe("voyado");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
    );
  });

  it("identifies Emarsys via brand-CNAMEd nrd.php/ems_l tracking links and VCE markup (no headers)", () => {
    // Distilled from a real COS (H&M group) send. Emarsys routes the
    // link-tracking edge through a brand CNAME (`link.e.cos.com`) and serves
    // assets from a sibling host (`link.service.cos.com/custloads/<acct>/…`),
    // so the `*.emarsys.net` host fingerprints never fire. Detection leans on
    // the `nrd.php?…&ems_l=…&_esuh=…` click shape, the `gm.php?prm=` web-view
    // link, the `/mo/…​.gif` open pixel and the Visual Content Editor markers
    // (`ems:preheader`, `e-block-id`, `e-editable`).
    const html = `
      <html e-locale="en-DK" e-is-multilanguage="true"><body>
        <div ems:preheader style="display:none">The latest effortless arrivals</div>
        <tr e-block-id="69e9e047c1b321360e00000b"><td>
          <a e-editable="urlA_1" href="https://link.e.cos.com/u/nrd.php?p=ZHWQ8PITfU_559356_558941_1_343&ems_l=924304&i=1&d=U0hPUA&_esuh=_11_7e8622bd1f519fff">SHOP NEW ARRIVALS</a>
        </td></tr>
        <a href="https://link.e.cos.com/u/gm.php?prm=ZHWQ8PITfU_1065630013_558941_559356&_esuh=_11_7f866bb1">view in your browser</a>
        <img src="https://link.e.cos.com/mo/ZHWQ8PITfU_1065630013_558941_559356_924304.gif" height="2" width="2" alt="" />
      </body></html>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://link.e.cos.com/u/nrd.php?p=ZHWQ8PITfU_559356_558941_1_343&ems_l=924304&i=1&d=U0hPUA&_esuh=_11_7e8622bd1f519fff"
        ),
        link(
          "https://link.e.cos.com/u/gm.php?prm=ZHWQ8PITfU_1065630013_558941_559356&_esuh=_11_7f866bb1"
        )
      ],
      resourceHosts: ["link.e.cos.com", "link.service.cos.com"]
    });
    expect(result.provider).toBe("emarsys");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Dynamics 365 Customer Insights – Journeys via mkt.dynamics.com tracking links and msdynmkt_* params (no headers)", () => {
    // Distilled from a real Sweet Protection (Active Brands) send. Dynamics
    // routes clicks through `public-<region>.mkt.dynamics.com/api/orgs/<org>/r/<token>`
    // with the `msdynmkt_target` / `msdynmkt_digest` / `msdynmkt_secretVersion`
    // query params, serves assets from
    // `assets-<region>.mkt.dynamics.com/<org>/digitalassets/(images|fonts)/…`,
    // tracks opens via `/api/orgs/<org>/i/<token>`, and stamps
    // `data-msdyn-tracking-id` on tracked anchors.
    const html = `
      <a href="https://public-eur.mkt.dynamics.com/api/orgs/3c78829e-e51c-4064-9990-00b0b7114a17/r/17hUm-AvKE605uICaWUCAAEAAAA?msdynmkt_target=%7B%22TargetUrl%22%3A%22https%253A%252F%252Fwww.sweetprotection.com%252Feu%252Fen%252F%22%7D&msdynmkt_digest=knMvM9Od5dWX17kEt48agA7fhKR8AIdm6K9T5aI46yA%3D&msdynmkt_secretVersion=7bb221762d0c46939816d3a5592b1359" data-msdyn-tracking-id="67c5ad726e41d1698936128337">
        <img src="https://assets-eur.mkt.dynamics.com/3c78829e-e51c-4064-9990-00b0b7114a17/digitalassets/images/cac74890-8d79-ee11-8179-0022489b6e07?ts=638345327487636388" alt="Logo" />
      </a>
      <img src="https://public-eur.mkt.dynamics.com/api/orgs/3c78829e-e51c-4064-9990-00b0b7114a17/i/17hUm-AvKE605uICaWUCAC8AAAA" width="0" height="0" data-tracking />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://public-eur.mkt.dynamics.com/api/orgs/3c78829e-e51c-4064-9990-00b0b7114a17/r/17hUm-AvKE605uICaWUCAAEAAAA?msdynmkt_target=%7B%22TargetUrl%22%3A%22https%253A%252F%252Fwww.sweetprotection.com%252Feu%252Fen%252F%22%7D&msdynmkt_digest=knMvM9Od5dWX17kEt48agA7fhKR8AIdm6K9T5aI46yA%3D&msdynmkt_secretVersion=7bb221762d0c46939816d3a5592b1359"
        )
      ],
      resourceHosts: [
        "public-eur.mkt.dynamics.com",
        "assets-eur.mkt.dynamics.com"
      ]
    });
    expect(result.provider).toBe("dynamics_365");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["link_host", "html_marker", "link_url"])
    );
  });

  it("identifies Adobe Campaign Classic via brand-CNAMEd /r/?id=h<uuid>,<hex>,<hex> tracking links and AEM x-cq-linkchecker markup (no headers)", () => {
    // Distilled from a real H&M send. Adobe Campaign Classic routes clicks
    // through a brand CNAME (`t19.email.hm.com`) with a `/r/?id=h<uuid>,<hex>,<hex>`
    // shape plus the `did`/`rid`/`erid` / `p1=DM…` parameter combo, fires the
    // open pixel from the same endpoint with a trailing `,1`, and the HTML
    // carries the AEM Communiqué `x-cq-linkchecker="skip"` attribute and the
    // `_type="optout"` annotation on the unsubscribe link. The `neolane.net`
    // host fingerprint never fires for this kind of brand-CNAMEd send.
    const html = `
      <a href="https://t19.email.hm.com/r/?id=hcc502c8a-5707-4ace-aaf0-a23f786fd662,53f15e99,f703031e&did=1408327321&rid=3326774977&erid=MzMyNjc3NDk3Nw%3D%3D&p1=DM5714525&p2=0982dd0aa7b117bf086dee6ed4af7d0c&p3=20260617" x-cq-linkchecker="skip">Shop nu</a>
      <a class="footer-unsubscribe-link-text" href="https://t19.email.hm.com/r/?id=hcc502c8a-5707-4ace-aaf0-a23f786fd662,53f15e99,f7030389&did=1408327321&rid=3326774977&erid=MzMyNjc3NDk3Nw%3D%3D&p1=DM5714525&p2=0982dd0aa7b117bf086dee6ed4af7d0c&p3=20260617&p4=3326774977&p5=1b5766ef895e25a1b52cd4793b914e08" x-cq-linkchecker="skip" _type="optout">Afmeld</a>
      <img height="0" width="0" alt="" src="https://t19.email.hm.com/r/?id=hcc502c8a-5707-4ace-aaf0-a23f786fd662,53f15e99,1" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://t19.email.hm.com/r/?id=hcc502c8a-5707-4ace-aaf0-a23f786fd662,53f15e99,f703031e&did=1408327321&rid=3326774977&erid=MzMyNjc3NDk3Nw%3D%3D&p1=DM5714525&p2=0982dd0aa7b117bf086dee6ed4af7d0c&p3=20260617"
        ),
        link(
          "https://t19.email.hm.com/r/?id=hcc502c8a-5707-4ace-aaf0-a23f786fd662,53f15e99,f7030389&did=1408327321&rid=3326774977&erid=MzMyNjc3NDk3Nw%3D%3D&p1=DM5714525&p2=0982dd0aa7b117bf086dee6ed4af7d0c&p3=20260617&p4=3326774977&p5=1b5766ef895e25a1b52cd4793b914e08"
        )
      ],
      resourceHosts: ["t19.email.hm.com"]
    });
    expect(result.provider).toBe("adobe_campaign");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Yulsn via brand-CNAMEd /e/<base64-JSON> tracking links and block-editor data-cntnt-typ markup (no headers)", () => {
    // Distilled from a real NORMAL (normal.dk) send. Yulsn routes tracked
    // links through a brand CNAME (`link.normal.dk/e/<base64url-JSON>`) with
    // the `eyJJIjoi` prefix (base64 of `{"I":"`), serves images from the same
    // edge under `/m/<digits>/…`, hard-codes `utm_source=yulsn` into the click
    // params, and CNAMEs the unsubscribe/web-view endpoint to
    // `yulsn.<brand>.tld/l/(unsubscribe|webversion)`. The HTML carries the
    // block-editor's `data-cntnt-typ` and `data-caedvar` markers in comments.
    const html = `
      <!--=div data-cntnt-typ="blocks" data-caedvar="1"=-->
      <!--=div data-cntnt-typ="block" data-id="140" data-bid="1"><div data-cntnt-typ="block-content"=-->
      <a href="https://link.normal.dk/e/eyJJIjoiMnw0ZGFiOGMwMmYyOTA0ZDczYmU0ZmEyYmNjZDExNGIyNHw3MXw1ODc4MjczMTNjOWIxM2JmNzZlYmU5Y2ZmMTI3NDMwNiIsIlAiOnsidXRtX21lZGl1bSI6ImVtYWlsIiwidXRtX3NvdXJjZSI6Inl1bHNuIiwidXRtX2NhbXBhaWduIjoiW01lc3NhZ2UuTmFtZV0ifSwiRiI6eyJNZXNzYWdlLk5hbWUiOiJMb3cgcHJpY2VzIGp1bmUgNl8yMDIwNiIsIkNvbnRhY3QuU2VjcmV0IjoiZGtkSGJpUWJkajBNcG8ifSwiSCI6Imh0dHBzOi8vbm9ybWFsLmRrIn0">Shop now</a>
      <a href="https://link.normal.dk/e/eyJJIjoiMnw0ZGFiOGMwMmYyOTA0ZDczYmU0ZmEyYmNjZDExNGIyNHw3MXw2ODFjMjM5NzQ5OTFmZGFjNWUwZTFmMDhlMzc5NzhiNSIsIkgiOiJodHRwczovL3l1bHNuLm5vcm1hbC5kay9sL3Vuc3Vic2NyaWJlP3M9JTVCQ29udGFjdC5TZWNyZXQlNUQifQ?utm_source=yulsn">Afmeld nyhedsbrev</a>
      <img src="https://link.normal.dk/m/526/AFLP_Juni-02.jpg" />
      <img src="https://link.normal.dk/e/eyJJIjoiMXw0ZGFiOGMwMmYyOTA0ZDczYmU0ZmEyYmNjZDExNGIyNHw3MXwifQ" alt="" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://link.normal.dk/e/eyJJIjoiMnw0ZGFiOGMwMmYyOTA0ZDczYmU0ZmEyYmNjZDExNGIyNHw3MXw1ODc4MjczMTNjOWIxM2JmNzZlYmU5Y2ZmMTI3NDMwNiIsIlAiOnsidXRtX21lZGl1bSI6ImVtYWlsIiwidXRtX3NvdXJjZSI6Inl1bHNuIiwidXRtX2NhbXBhaWduIjoiW01lc3NhZ2UuTmFtZV0ifSwiRiI6eyJNZXNzYWdlLk5hbWUiOiJMb3cgcHJpY2VzIGp1bmUgNl8yMDIwNiIsIkNvbnRhY3QuU2VjcmV0IjoiZGtkSGJpUWJkajBNcG8ifSwiSCI6Imh0dHBzOi8vbm9ybWFsLmRrIn0"
        ),
        link(
          "https://link.normal.dk/e/eyJJIjoiMnw0ZGFiOGMwMmYyOTA0ZDczYmU0ZmEyYmNjZDExNGIyNHw3MXw2ODFjMjM5NzQ5OTFmZGFjNWUwZTFmMDhlMzc5NzhiNSIsIkgiOiJodHRwczovL3l1bHNuLm5vcm1hbC5kay9sL3Vuc3Vic2NyaWJlP3M9JTVCQ29udGFjdC5TZWNyZXQlNUQifQ?utm_source=yulsn"
        )
      ],
      resourceHosts: ["link.normal.dk", "yulsn.normal.dk"]
    });
    expect(result.provider).toBe("yulsn");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Flodesk via fdske.com tracking subdomain and usercontent.flodesk.com assets (no headers)", () => {
    // Distilled from a real Copenhagen Contemporary (cphco.org) send. Flodesk
    // hosts images at `usercontent.flodesk.com` and forms at
    // `form.flodesk.com`, and routes click tracking through tenant-scoped
    // `<6char>.<4char>.fdske.com` short-tracking subdomains.
    const html = `
      <a href="https://h2e86z.fh50.fdske.com/m/01J9XYZ123ABC">RSVP</a>
      <img src="https://usercontent.flodesk.com/abcd-1234-efgh-5678/raw/upload/hero.jpg" />
      <iframe src="https://form.flodesk.com/forms/embed/abcd1234"></iframe>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [link("https://h2e86z.fh50.fdske.com/m/01J9XYZ123ABC")],
      resourceHosts: ["h2e86z.fh50.fdske.com", "usercontent.flodesk.com", "form.flodesk.com"]
    });
    expect(result.provider).toBe("flodesk");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("identifies Oracle Responsys via _ri_/_ei_ tracking URL parameters and brand-CNAMEd /pub/acc shape (no headers)", () => {
    // Distilled from a real Zara Home (Inditex) send. Oracle Responsys (acquired
    // 2014) routes click tracking through a brand CNAME on the sender's domain
    // (`news.zarahome.com`) with a `/pub/acc?_ri_=...&_ei_=...` URL shape. The
    // `_ri_` (recipient ID) and `_ei_` (entity/event ID) parameter pair is a
    // Responsys-only convention dating from the pre-Oracle era.
    const html = `
      <a href="https://news.zarahome.com/pub/acc?_ri_=X0Gzc2X%3DBQjkPkSTYQGwgldNuj5qp9fhvsHWvEzaPpJX3XpAMBR0ykaO0T2XqOFlIApzfXBfsR3VXtpKX%3DSRCBDYURT&_ei_=EZllT9hXuvHxMAOlULFtCKFwVVpI0i47gCbA">Shop new in</a>
      <a href="https://news.zarahome.com/pub/optout?_ri_=X0Gzc2X%3DBQjkPkSTYQ&_ei_=ABcDeFg">Unsubscribe</a>
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://news.zarahome.com/pub/acc?_ri_=X0Gzc2X%3DBQjkPkSTYQGwgldNuj5qp9fhvsHWvEzaPpJX3XpAMBR0ykaO0T2XqOFlIApzfXBfsR3VXtpKX%3DSRCBDYURT&_ei_=EZllT9hXuvHxMAOlULFtCKFwVVpI0i47gCbA"
        )
      ],
      resourceHosts: ["news.zarahome.com"]
    });
    expect(result.provider).toBe("responsys");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Cordial via brand-CNAMEd /click?E.../C.../V... multi-segment base64url path (no headers)", () => {
    // Distilled from a real Ralph Lauren EU send. Cordial routes click
    // tracking through a brand CNAME (`e.mail.<brand>.com`) with a multi-
    // segment base64url path where each segment carries a leading letter
    // identifying its purpose (E=encrypted recipient, C=campaign, V=visit).
    const fullUrl =
      "https://e.mail.ralphlauren.eu/click?EcmFscGgtbGF1cmVuLTIwMjYwNjA2QHBpcm9sLmFwcA/CeyJtaWQiOiIxNzgwNzY5MzI2MTIwNGY5NDk2Y2ExNDZjIn0/VaHR0cHM6Ly92aWV3Lm1haWwucmFscGhsYXVyZW4uZXU/SWkhfbXJlX05OVEFOMDYwNjIwMjZjMjEyOTczMw/Lcm0x/qP3V0bV90ZXJtPWFsbA/gaiRiQQ/JMDYwNjIwMjZDMjEyOTczMw/sch2589c07e";
    const html = `<a href="${fullUrl}">Shop now</a>`;
    const result = detectEsp({
      headers: {},
      html,
      links: [link(fullUrl)],
      resourceHosts: ["e.mail.ralphlauren.eu"]
    });
    expect(result.provider).toBe("cordial");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Bloomreach Engagement (Exponea rebrand) via brxcdn.com CDN and /ee/v1/webview shape (no headers)", () => {
    // Distilled from real Acne Studios and Miu Miu sends. Bloomreach
    // Engagement (Exponea's new owner) keeps the legacy `/e/<token>/click`
    // tracking shape on brand-CNAMEd hosts (`link.acnestudios.com/<tenant>-prod/e/<token>/click`)
    // but serves assets from a new CDN (`brxcdn.com/<region>-app-storage/…`)
    // and exposes a `/ee/v1/webview?params=v1.<base64>` endpoint for the
    // web-preview / view-in-browser link (CNAMEd to `data.email.<brand>.com`).
    const html = `
      <a href="https://link.acnestudios.com/acnestudios-prod/e/.eJzj4smSaPr772BlVZB8_UEhBZHsXKaFfOuYNJ-ZC8x2ijG8ui9Vrs2Ws4vhSPXcKWV3XAwDM5TPLO645ZjFk5nevrg7fk7wioXu008wMl5ilODiTY4vT00qzixJjS9KLBdiT0zOS41Pyb7EKMLFCZdCEhbi4kmOz8lPTsyB.rvTze01UsD2U5Q/click">Shop FW26</a>
      <a href="https://data.email.miumiu.com/ee/v1/webview?params=v1.iVVwCZmkZTaYqzPM00ngsFOtjgmU-lpkdJt4VHPWtP4z_2Jd86ToUGIcc6fBEHVAw30i1PlIpyh7B5WIvarwGSYbka4B1f13BavcS-CzXdyzoOHE0-b6mXN3-LblVI">View in browser</a>
      <img src="https://brxcdn.com/eu3-app-storage/a8e1e80e-d9a3-11f0-80a5-a2228360da40/media/original/3752c102-da8b-11f0-bc4c-a601a9989010" />
    `;
    const result = detectEsp({
      headers: {},
      html,
      links: [
        link(
          "https://link.acnestudios.com/acnestudios-prod/e/.eJzj4smSaPr772BlVZB8_UEhBZHsXKaFfOuYNJ-ZC8x2ijG8ui9Vrs2Ws4vhSPXcKWV3XAwDM5TPLO645ZjFk5nevrg7fk7wioXu008wMl5ilODiTY4vT00qzixJjS9KLBdiT0zOS41Pyb7EKMLFCZdCEhbi4kmOz8lPTsyB.rvTze01UsD2U5Q/click"
        ),
        link(
          "https://data.email.miumiu.com/ee/v1/webview?params=v1.iVVwCZmkZTaYqzPM00ngsFOtjgmU-lpkdJt4VHPWtP4z_2Jd86ToUGIcc6fBEHVAw30i1PlIpyh7B5WIvarwGSYbka4B1f13BavcS-CzXdyzoOHE0-b6mXN3-LblVI"
        )
      ],
      resourceHosts: ["link.acnestudios.com", "data.email.miumiu.com", "brxcdn.com"]
    });
    expect(result.provider).toBe("exponea");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["html_marker", "link_url"])
    );
  });

  it("identifies Klaviyo on a dedicated-SendGrid tenant via x-kmail-* headers and the kmail-lists.com unsubscribe host (Resend `list` blob, brand-CNAMEd tracker)", () => {
    // Distilled from a real Patagonia send. Delivery runs through SendGrid
    // (x-sg-eid, bounces+…@em.na.patagonia.com) with every click/open link
    // wrapped by SendGrid's brand-CNAMEd tracker (`trk.na.patagonia.com/ls/
    // click?upn=u001.…`), so no Klaviyo host, class marker, or URL shape
    // appears anywhere in the body. The composing platform is only visible in
    // the transport headers (x-kmail-account/message/ops) and in the
    // List-Unsubscribe endpoint on manage.kmail-lists.com — which Resend
    // surfaces as a JSON blob under the folded `list` header key, not as a
    // raw `list-unsubscribe` header. Klaviyo (the composer) must outrank
    // SendGrid (the transport).
    const result = detectEsp({
      headers: {
        "x-sg-eid": "u001.8l22YAme1b9WP62dO4kbSJ",
        "x-kmail-account": "YgU9me",
        "x-kmail-message": "01KVTW2GPWWSNF8S2GTH9JM9CE",
        "x-kmail-ops": "01KTF0EB8WGWB9AMZENYDH1VYK",
        "return-path": "bounces+30602736-0063-user=example.com@em.na.patagonia.com",
        list: JSON.stringify({
          unsubscribe: {
            url: "https://manage.kmail-lists.com/subscriptions/unsubscribe?a=YgU9me&c=01KTF0EB8WGWB9AMZENYDH1VYK&k=13bd&m=01KVTW2GPWWSNF8S2GTH9JM9CE"
          },
          "unsubscribe-post": { name: "List-Unsubscribe=One-Click" }
        })
      },
      html: '<a href="https://trk.na.patagonia.com/ls/click?upn=u001.sIJIdDSs4ZUW45aJuUQ5ST">Shop</a><img src="https://trk.na.patagonia.com/wf/open?upn=u001.cvFzIFhJn0j" width="1" height="1" />',
      links: [link("https://trk.na.patagonia.com/ls/click?upn=u001.sIJIdDSs4ZUW45aJuUQ5ST")],
      resourceHosts: ["trk.na.patagonia.com", "images.patagonia.com"]
    });
    expect(result.provider).toBe("klaviyo");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["x_header", "list_unsubscribe"])
    );
    const sendgrid = result.candidates.find((c) => c.provider === "sendgrid");
    expect(sendgrid).toBeDefined();
    expect(result.confidence).toBeGreaterThan(sendgrid!.score);
  });

  it("matches end-anchored host patterns against the raw RFC 2369 List-Unsubscribe header", () => {
    // The host patterns are anchored with `$`, so they can only match once the
    // unsubscribe URI is reduced to its bare host — testing them against the
    // full `<https://…>` header string can never fire.
    const result = detectEsp({
      headers: {
        "List-Unsubscribe": "<https://manage.kmail-lists.com/subscriptions/unsubscribe?a=abc>, <mailto:unsub@kmail-lists.com>"
      },
      html: "<p>Hello</p>",
      links: []
    });
    const klaviyo = result.candidates.find((c) => c.provider === "klaviyo");
    expect(klaviyo).toBeDefined();
    expect(result.signals.map((s) => s.kind)).toContain("list_unsubscribe");
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
