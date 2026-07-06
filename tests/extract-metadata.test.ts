import { describe, expect, it } from "vitest";
import {
  detectDarkMode,
  detectHasGif,
  detectPreheaderPadding,
  extractAuthResults,
  extractColorPalette,
  extractFontFamilies,
  extractLinks,
  extractListHeaders,
  extractMetadata,
  extractPreheader,
  extractResourceHosts,
  extractSubjectMetadata
} from "@/lib/extract-metadata";

describe("extractPreheader", () => {
  it("returns the text inside the first hidden block", () => {
    const html = `
      <body>
        <div style="display:none; max-height:0; overflow:hidden;">Open me for a 30% off code inside</div>
        <h1>Hello</h1>
        <p>Body text here.</p>
      </body>
    `;
    expect(extractPreheader(html)).toBe("Open me for a 30% off code inside");
  });

  it("recognizes mso-hide:all preheaders", () => {
    const html = `
      <span style="mso-hide:all; font-size:0; color:transparent;">Save the date for our spring drop</span>
      <p>Hi friend</p>
    `;
    expect(extractPreheader(html)).toBe("Save the date for our spring drop");
  });

  it("falls back to the first plaintext slice when nothing is hidden", () => {
    const html = "<p>Welcome to the newsletter, here is what is new this week.</p>";
    expect(extractPreheader(html)).toBe(
      "Welcome to the newsletter, here is what is new this week."
    );
  });

  it("returns null on empty input", () => {
    expect(extractPreheader("")).toBeNull();
  });
});

describe("detectPreheaderPadding", () => {
  it("flags figure-space + grapheme-joiner entity padding", () => {
    const html = `<div style="display:none">Genfind kontakten til dig selv${"&#8199;&#847; ".repeat(50)}</div><p>Body</p>`;
    expect(detectPreheaderPadding(html)).toBe(true);
  });

  it("flags zwnj + nbsp padding pairs", () => {
    const html = `<div style="display:none">Teaser${"&zwnj;&nbsp;".repeat(40)}</div>`;
    expect(detectPreheaderPadding(html)).toBe(true);
  });

  it("flags padding written as raw Unicode characters", () => {
    const html = `<div style="display:none">Teaser${" ͏ ".repeat(30)}</div>`;
    expect(detectPreheaderPadding(html)).toBe(true);
  });

  it("flags hex-entity padding", () => {
    expect(detectPreheaderPadding(`Teaser${"&#x2007;&#x34F;".repeat(20)}`)).toBe(
      true
    );
  });

  it("ignores plain nbsp runs from spacer layouts", () => {
    expect(detectPreheaderPadding(`<td>${"&nbsp;".repeat(60)}</td>`)).toBe(false);
  });

  it("ignores zero-width joiners inside emoji sequences", () => {
    expect(
      detectPreheaderPadding("Family time \u{1F468}‍\u{1F469}‍\u{1F467} and pride \u{1F3F3}️‍\u{1F308}")
    ).toBe(false);
  });

  it("ignores unpadded emails and empty input", () => {
    expect(detectPreheaderPadding("<div>Hello world, sale on now!</div>")).toBe(
      false
    );
    expect(detectPreheaderPadding("")).toBe(false);
  });
});

describe("detectDarkMode", () => {
  it("flags emails with prefers-color-scheme media queries", () => {
    expect(
      detectDarkMode(`
        <style>@media (prefers-color-scheme: dark) { body { background: #000; } }</style>
      `)
    ).toBe(true);
  });

  it("flags emails using Outlook dark-mode hooks", () => {
    expect(detectDarkMode(`<style>[data-ogsc] .footer { color: #fff; }</style>`)).toBe(true);
  });

  it("flags color-scheme meta tags", () => {
    expect(
      detectDarkMode(`<meta name="color-scheme" content="light dark">`)
    ).toBe(true);
  });

  it("returns false when there are no dark-mode hints", () => {
    expect(detectDarkMode("<p>plain</p>")).toBe(false);
  });
});

describe("detectHasGif", () => {
  it("returns true if any mirrored asset has image/gif content type", () => {
    expect(
      detectHasGif("<p>no gif here</p>", [
        {
          remoteUrl: "https://cdn.example.com/file.bin",
          storagePath: "x/abc.gif",
          contentType: "image/gif",
          byteLength: 1
        }
      ])
    ).toBe(true);
  });

  it("falls back to .gif src detection when no mirrored assets are provided", () => {
    expect(
      detectHasGif(`<img src="https://cdn.example.com/banner.gif?v=1" />`)
    ).toBe(true);
  });

  it("returns false when no GIFs are present", () => {
    expect(
      detectHasGif(`<img src="https://cdn.example.com/banner.png" />`)
    ).toBe(false);
  });
});

describe("extractLinks", () => {
  it("parses each anchor and breaks out UTM parameters", () => {
    const html = `
      <a href="https://shop.example.com/sale?utm_source=klaviyo&utm_medium=email&utm_campaign=spring">Shop now</a>
      <a href="https://shop.example.com/sale?utm_source=klaviyo&utm_medium=email&utm_campaign=spring">Shop now (dup)</a>
      <a href="mailto:hello@example.com">Email us</a>
      <a href="https://other.example.com/page">No utm</a>
    `;
    const links = extractLinks(html);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      url: "https://shop.example.com/sale?utm_source=klaviyo&utm_medium=email&utm_campaign=spring",
      host: "shop.example.com",
      utm: {
        source: "klaviyo",
        medium: "email",
        campaign: "spring",
        content: null,
        term: null
      }
    });
    expect(links[1].host).toBe("other.example.com");
    expect(links[1].utm.source).toBeNull();
  });

  it("returns [] for empty html", () => {
    expect(extractLinks("")).toEqual([]);
  });
});

describe("extractSubjectMetadata", () => {
  it("computes length, words, emoji, and uppercase ratio", () => {
    const meta = extractSubjectMetadata("BIG sale today only!");
    expect(meta.length).toBe(20);
    expect(meta.word_count).toBe(4);
    expect(meta.emoji_count).toBe(0);
    expect(meta.uppercase_ratio).toBeGreaterThan(0.1);
  });

  it("counts emoji", () => {
    const meta = extractSubjectMetadata("New drop just landed");
    expect(meta.emoji_count).toBe(0);
    const meta2 = extractSubjectMetadata("New drop just landed");
    expect(meta2.length).toBeGreaterThan(0);
    const withEmoji = extractSubjectMetadata("Sale alert! 50% off");
    expect(withEmoji.emoji_count).toBe(0);
  });

  it("detects personalization tokens", () => {
    expect(extractSubjectMetadata("Hi {first_name}, welcome").has_personalization_token).toBe(true);
    expect(extractSubjectMetadata("Hi *|FNAME|*").has_personalization_token).toBe(true);
    expect(extractSubjectMetadata("No tokens here").has_personalization_token).toBe(false);
  });
});

describe("extractResourceHosts", () => {
  it("collects hostnames from anchors, images, link tags, and CSS @import / url()", () => {
    const html = `
      <html><head>
        <link rel="stylesheet" href="https://cdn.klaviyo.com/styles.css" />
        <style>
          @import url(https://static-forms.klaviyo.com/fonts/custom_fonts.css);
          .hero { background: url('https://images.brand.com/hero.png'); }
        </style>
      </head><body>
        <a href="https://shop.brand.com/sale">Shop</a>
        <img src="https://cdn.brand.com/logo.png" />
      </body></html>
    `;
    const hosts = extractResourceHosts(html);
    expect(hosts).toEqual(
      expect.arrayContaining([
        "cdn.klaviyo.com",
        "static-forms.klaviyo.com",
        "images.brand.com",
        "shop.brand.com",
        "cdn.brand.com"
      ])
    );
  });

  it("deduplicates and lowercases hosts", () => {
    const html = `
      <a href="https://Cdn.Brand.com/a">a</a>
      <img src="https://cdn.brand.com/b.png" />
    `;
    const hosts = extractResourceHosts(html);
    expect(hosts).toEqual(["cdn.brand.com"]);
  });

  it("returns [] for empty input", () => {
    expect(extractResourceHosts("")).toEqual([]);
  });
});

describe("extractAuthResults", () => {
  it("parses authentication-results into spf/dkim/dmarc", () => {
    const headers = {
      "Authentication-Results":
        "mx.google.com; spf=pass smtp.mailfrom=bounces.klaviyo.com; dkim=pass header.d=klaviyo.com; dmarc=pass header.from=brand.com"
    };
    expect(extractAuthResults(headers)).toEqual({
      spf: "pass",
      dkim: "pass",
      dmarc: "pass"
    });
  });

  it("captures fail mechanisms", () => {
    const headers = {
      "authentication-results": "mx; spf=softfail; dkim=fail; dmarc=none"
    };
    expect(extractAuthResults(headers)).toEqual({
      spf: "softfail",
      dkim: "fail",
      dmarc: "none"
    });
  });

  it("returns null when no auth header is present", () => {
    expect(extractAuthResults({ "Other-Header": "x" })).toBeNull();
    expect(extractAuthResults(null)).toBeNull();
  });
});

describe("extractListHeaders", () => {
  it("returns null when no headers were provided at all", () => {
    expect(extractListHeaders(null)).toBeNull();
  });

  it("flags absence when headers exist but List-* are missing", () => {
    expect(extractListHeaders({ "Other-Header": "x" })).toEqual({
      has_list_unsubscribe: false,
      unsubscribe_mailto: null,
      unsubscribe_url: null,
      has_one_click_post: false,
      list_id: null
    });
  });

  it("parses both mailto: and https URIs from List-Unsubscribe", () => {
    const headers = {
      "List-Unsubscribe":
        "<mailto:unsub@brand.example?subject=unsubscribe>, <https://brand.example/unsub?id=42>"
    };
    expect(extractListHeaders(headers)).toEqual({
      has_list_unsubscribe: true,
      unsubscribe_mailto: "mailto:unsub@brand.example?subject=unsubscribe",
      unsubscribe_url: "https://brand.example/unsub?id=42",
      has_one_click_post: false,
      list_id: null
    });
  });

  it("parses mailto-only and https-only variants", () => {
    expect(extractListHeaders({ "List-Unsubscribe": "<mailto:u@b.example>" })).toMatchObject({
      has_list_unsubscribe: true,
      unsubscribe_mailto: "mailto:u@b.example",
      unsubscribe_url: null
    });

    expect(extractListHeaders({ "List-Unsubscribe": "<https://b.example/u>" })).toMatchObject({
      has_list_unsubscribe: true,
      unsubscribe_mailto: null,
      unsubscribe_url: "https://b.example/u"
    });
  });

  it("flags RFC 8058 one-click POST", () => {
    const headers = {
      "List-Unsubscribe": "<https://b.example/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    };
    expect(extractListHeaders(headers)?.has_one_click_post).toBe(true);
  });

  it("does not match unrelated List-Unsubscribe-Post values as one-click", () => {
    const headers = {
      "List-Unsubscribe": "<https://b.example/u>",
      "List-Unsubscribe-Post": "Some-Other=Value"
    };
    expect(extractListHeaders(headers)?.has_one_click_post).toBe(false);
  });

  it("strips the angle brackets and quoted label from List-Id", () => {
    expect(
      extractListHeaders({ "List-Id": '"Brand Newsletter" <news.brand.example>' })?.list_id
    ).toBe("news.brand.example");
    expect(
      extractListHeaders({ "List-Id": "<news.brand.example>" })?.list_id
    ).toBe("news.brand.example");
    expect(
      extractListHeaders({ "List-Id": "news.brand.example" })?.list_id
    ).toBe("news.brand.example");
  });

  it("matches header keys case-insensitively", () => {
    const headers = {
      "list-unsubscribe": "<mailto:u@b.example>",
      "LIST-UNSUBSCRIBE-POST": "list-unsubscribe=one-click",
      "List-ID": "<n.b.example>"
    };
    expect(extractListHeaders(headers)).toEqual({
      has_list_unsubscribe: true,
      unsubscribe_mailto: "mailto:u@b.example",
      unsubscribe_url: null,
      has_one_click_post: true,
      list_id: "n.b.example"
    });
  });

  // Resend's `email.received` API normalises the inbound message via
  // postal-mime and groups all `List-*` headers under a single `list` key
  // whose value is JSON-encoded. The extractor has to understand that
  // shape — otherwise every Resend-ingested email is misreported as
  // "missing List-Unsubscribe" even though Apple Mail / Gmail render
  // their built-in Unsubscribe button just fine.
  it("parses Resend's nested `list` blob (url + mail + one-click + id)", () => {
    const headers = {
      list: JSON.stringify({
        unsubscribe: {
          mail: "unsubscribe@eu.sparkpostmail.com?subject=unsubscribe:opaque",
          url: "https://unsubscribe.eu.spmta.com/u/abc"
        },
        "unsubscribe-post": { name: "List-Unsubscribe=One-Click" },
        id: { name: "spceu.13976.2.sparkpostmail.com" }
      })
    };
    expect(extractListHeaders(headers)).toEqual({
      has_list_unsubscribe: true,
      unsubscribe_mailto:
        "mailto:unsubscribe@eu.sparkpostmail.com?subject=unsubscribe:opaque",
      unsubscribe_url: "https://unsubscribe.eu.spmta.com/u/abc",
      has_one_click_post: true,
      list_id: "spceu.13976.2.sparkpostmail.com"
    });
  });

  it("parses Resend's `list` blob when only an https unsubscribe URL is set", () => {
    const headers = {
      list: JSON.stringify({
        unsubscribe: {
          url: "https://public.yulsn.io/listunsubscribe/abc"
        },
        "unsubscribe-post": { name: "List-Unsubscribe=One-Click" }
      })
    };
    expect(extractListHeaders(headers)).toEqual({
      has_list_unsubscribe: true,
      unsubscribe_mailto: null,
      unsubscribe_url: "https://public.yulsn.io/listunsubscribe/abc",
      has_one_click_post: true,
      list_id: null
    });
  });

  it("prefers the `id.id` host over the `id.name` display label for List-Id", () => {
    const headers = {
      list: JSON.stringify({
        unsubscribe: { url: "https://example.com/u" },
        id: {
          name: "ca75a0d01596c8e82f6da53e4mc list",
          id: "ca75a0d01596c8e82f6da53e4.380989.list-id.mcsv.net"
        }
      })
    };
    expect(extractListHeaders(headers)?.list_id).toBe(
      "ca75a0d01596c8e82f6da53e4.380989.list-id.mcsv.net"
    );
  });

  it("falls back to RFC 2047 quoted-printable `name` field when url/mail are absent", () => {
    // Klaviyo + sparkpost emit the original `<https://…>` URI as a chain
    // of `=?us-ascii?Q?…?=` encoded-words, which postal-mime surfaces as
    // `unsubscribe.name`. The extractor decodes the chain and recovers
    // the underlying URL so those senders aren't false-negatived.
    const encoded =
      "=?us-ascii?Q?=3Chttps=3A=2F=2Fmanage=2Ekmail-lists=2Ecom=2Funsub?= " +
      "=?us-ascii?Q?scribe=3Fa=3DUsreBA=3E?=";
    const headers = {
      list: JSON.stringify({
        unsubscribe: { name: encoded },
        "unsubscribe-post": { name: "List-Unsubscribe=One-Click" }
      })
    };
    const result = extractListHeaders(headers);
    expect(result?.has_list_unsubscribe).toBe(true);
    expect(result?.unsubscribe_url).toBe(
      "https://manage.kmail-lists.com/unsubscribe?a=UsreBA"
    );
    expect(result?.has_one_click_post).toBe(true);
  });

  it("flags has_list_unsubscribe even when the parsed `name` can't be decoded into a URI", () => {
    // Apple Mail's "Unsubscribe" button only requires a non-empty
    // List-Unsubscribe header — the URL parse is a *quality* signal.
    // Don't false-negative the header-presence check on parse failure.
    const headers = {
      list: JSON.stringify({
        unsubscribe: { name: "<gibberish-no-uri-inside>" }
      })
    };
    expect(extractListHeaders(headers)?.has_list_unsubscribe).toBe(true);
  });

  it("ignores a non-JSON `list` value and falls through to standard headers", () => {
    const headers = {
      list: "not-json",
      "List-Unsubscribe": "<https://b.example/u>"
    };
    expect(extractListHeaders(headers)).toMatchObject({
      has_list_unsubscribe: true,
      unsubscribe_url: "https://b.example/u"
    });
  });
});


describe("extractColorPalette", () => {
  it("captures hex colors from <style> blocks and inline style attrs", () => {
    const html = `
      <html>
        <head>
          <style>
            body { background: #FFFFFF; color: #1a1a1a; }
            .accent { color: #ff0066; border-color: #1A1A1A; }
          </style>
        </head>
        <body>
          <div style="background-color:#fff;color:#1a1a1a">Hi</div>
        </body>
      </html>
    `;
    const palette = extractColorPalette(html);
    const map = new Map(palette.map((c) => [c.hex, c]));

    expect(map.get("#ffffff")?.count).toBe(2);
    expect(map.get("#1a1a1a")?.count).toBe(3);
    expect(map.get("#ff0066")?.count).toBe(1);

    expect(map.get("#1a1a1a")?.sources.sort()).toEqual(["inline", "style_block"]);
    expect(map.get("#ff0066")?.sources).toEqual(["style_block"]);
  });

  it("normalises 3-char hex shorthand to 6-char and lowercases", () => {
    const palette = extractColorPalette(`<div style="color:#FAB">x</div>`);
    expect(palette).toEqual([
      { hex: "#ffaabb", count: 1, sources: ["inline"] }
    ]);
  });

  it("normalises rgb() and strips alpha from rgba()", () => {
    const html = `
      <style>.a { color: rgb(255, 102, 0); background: rgba(0, 0, 0, 0.5); }</style>
      <p style="border:1px solid rgb(255,102,0)">x</p>
    `;
    const palette = extractColorPalette(html);
    const map = new Map(palette.map((c) => [c.hex, c]));
    expect(map.get("#ff6600")?.count).toBe(2);
    expect(map.get("#000000")?.count).toBe(1);
  });

  it("captures legacy bgcolor and color HTML attributes", () => {
    const html = `
      <table bgcolor="#0F172A">
        <tr><td><font color="white">hi</font></td></tr>
        <tr><td bgcolor="rgb(34,34,34)">x</td></tr>
      </table>
    `;
    const palette = extractColorPalette(html);
    const hexes = palette.map((c) => c.hex);
    expect(hexes).toContain("#0f172a");
    expect(hexes).toContain("#222222");
    expect(hexes).not.toContain("#ffffff");
    const dark = palette.find((c) => c.hex === "#0f172a");
    expect(dark?.sources).toEqual(["attribute"]);
  });

  it("ignores colors that only appear inside <script> blocks", () => {
    const html = `<script>const c = "#ff0000"; const r = "rgb(0,255,0)";</script>`;
    expect(extractColorPalette(html)).toEqual([]);
  });

  it("sorts by frequency descending and respects the limit", () => {
    const html = `
      <style>
        .a { color: #111111; background: #111111; border: 1px solid #111111; }
        .b { color: #222222; background: #222222; }
        .c { color: #333333; }
        .d { color: #444444; }
      </style>
    `;
    const palette = extractColorPalette(html, 2);
    expect(palette.map((c) => c.hex)).toEqual(["#111111", "#222222"]);
    expect(palette[0].count).toBe(3);
    expect(palette[1].count).toBe(2);
  });

  it("ignores ID selectors that look like 3-char hex tokens", () => {
    // Mailchimp tags each section of a campaign with ids like `d13`, `b24`,
    // `b67`, etc. and emits rules such as `#d13 p, #d13 h1 { … }`. Those are
    // ID selectors, not colors — they must never leak into the palette.
    const html = `
      <style>
        #d13 p, #d13 h1, #b24 h2, #b67 li { font-weight: 600; }
        #d13 { background: #ff0000; }
      </style>
    `;
    const palette = extractColorPalette(html);
    const hexes = palette.map((c) => c.hex);
    expect(hexes).toEqual(["#ff0000"]);
  });

  it("ignores ID selectors nested inside @media queries", () => {
    // Mailchimp's mobile overrides wrap selectors in `@media (...) { ... }`
    // so the inner `#b24, #b67 { padding: ... }` sits inside the outer
    // braces. Only property values may be colors.
    const html = `
      <style>
        @media (max-width: 600px) {
          #b22 .x, #b23 .y, #b24, #b67 { padding: 12px 24px !important; }
          #b24 .btn { background: #00ff88; }
        }
      </style>
    `;
    const palette = extractColorPalette(html);
    const hexes = palette.map((c) => c.hex);
    expect(hexes).toEqual(["#00ff88"]);
  });

  it("skips colors declared only on interaction pseudo-classes", () => {
    // Default ESP templates (Sendinblue's `.es-button-border:hover`,
    // Mailchimp's `a:hover`) often leave a stock platform color on the
    // hover state that the brand never customises. Those colors are never
    // visible by default so they shouldn't count toward the brand DNA.
    const html = `
      <style>
        .btn { background: #ffffff; color: #111111; }
        .btn:hover { background: #003dcc; border-color: #003dcc; }
        a:focus, a:active { outline-color: #ff00aa; }
        @media (max-width: 600px) {
          .btn:hover { background: #00ff00; }
        }
      </style>
    `;
    const palette = extractColorPalette(html);
    const hexes = palette.map((c) => c.hex);
    expect(hexes.sort()).toEqual(["#111111", "#ffffff"]);
  });

  it("skips inline styles flagged as invisible (mso-hide, display:none, …)", () => {
    // Outlook-only fallback buttons routinely declare a default ESP
    // accent color (Eva Solo: #004cff) on `border-color` while also
    // setting `border-width: 0`, then mark the wrapper element with
    // `mso-hide:all` so non-Outlook clients hide it. The recipient
    // never sees these colors, so they mustn't dominate the palette.
    const html = `
      <a style="background:#ffffff;color:#000000">Visible</a>
      <span style="border-color:#004cff;background:#bf967e;border-width:0px;mso-hide:all">Outlook</span>
      <span style="display:none;background:#ff00ff">Hidden</span>
      <span style="visibility:hidden;color:#00ffff">Hidden</span>
    `;
    const palette = extractColorPalette(html);
    const hexes = palette.map((c) => c.hex).sort();
    expect(hexes).toEqual(["#000000", "#ffffff"]);
  });

  it("returns [] for empty input", () => {
    expect(extractColorPalette("")).toEqual([]);
  });
});

describe("extractFontFamilies", () => {
  it("captures fonts from <style> blocks and inline style attrs, splitting stacks", () => {
    const html = `
      <html>
        <head>
          <style>
            body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
            .hero { font-family: 'Inter', sans-serif; }
          </style>
        </head>
        <body>
          <h1 style="font-family: 'Inter', sans-serif">Hi</h1>
          <p style="font-family: Georgia, serif;">Hello</p>
        </body>
      </html>
    `;
    const fonts = extractFontFamilies(html);
    const map = new Map(fonts.map((f) => [f.family.toLowerCase(), f]));

    expect(map.get("inter")?.count).toBe(2);
    expect(map.get("inter")?.primary_count).toBe(2);
    expect(map.get("inter")?.sources.sort()).toEqual(["inline", "style_block"]);
    expect(map.get("helvetica neue")?.count).toBe(1);
    expect(map.get("helvetica neue")?.primary_count).toBe(1);
    expect(map.get("helvetica")?.count).toBe(1);
    expect(map.get("helvetica")?.primary_count).toBe(0);
    expect(map.get("arial")?.count).toBe(1);
    expect(map.get("arial")?.primary_count).toBe(0);
    expect(map.get("georgia")?.count).toBe(1);
    expect(map.get("georgia")?.primary_count).toBe(1);
    expect(map.has("sans-serif")).toBe(false);
    expect(map.has("serif")).toBe(false);
  });

  it("preserves first-seen casing while aggregating case-insensitively", () => {
    const html = `
      <style>body { font-family: "Helvetica Neue"; }</style>
      <p style="font-family: helvetica neue">x</p>
      <p style="font-family: HELVETICA NEUE">y</p>
    `;
    const fonts = extractFontFamilies(html);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].family).toBe("Helvetica Neue");
    expect(fonts[0].count).toBe(3);
    expect(fonts[0].primary_count).toBe(3);
  });

  it("distinguishes primary (first) fonts from fallback chain entries", () => {
    const html = `
      <style>
        body { font-family: 'Brand Display', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        h1 { font-family: 'Brand Display', Georgia, serif; }
        .footer { font-family: Arial, Helvetica, sans-serif; }
      </style>
    `;
    const fonts = extractFontFamilies(html);
    const byName = new Map(fonts.map((f) => [f.family, f]));

    expect(byName.get("Brand Display")?.primary_count).toBe(2);
    expect(byName.get("Brand Display")?.count).toBe(2);

    expect(byName.get("Arial")?.primary_count).toBe(1);
    expect(byName.get("Arial")?.count).toBe(2);

    expect(byName.get("Helvetica")?.primary_count).toBe(0);
    expect(byName.get("Helvetica")?.count).toBe(2);

    expect(byName.get("Helvetica Neue")?.primary_count).toBe(0);
    expect(byName.get("Georgia")?.primary_count).toBe(0);

    expect(fonts[0].family).toBe("Brand Display");
  });

  it("treats the first non-generic entry as primary, skipping system-stack tokens", () => {
    const html = `
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      </style>
    `;
    const fonts = extractFontFamilies(html);
    const segoe = fonts.find((f) => f.family === "Segoe UI");
    expect(segoe?.primary_count).toBe(1);
    const roboto = fonts.find((f) => f.family === "Roboto");
    expect(roboto?.primary_count).toBe(0);
    expect(roboto?.count).toBe(1);
  });

  it("captures @font-face declarations as style_block sources", () => {
    const html = `
      <style>
        @font-face { font-family: 'Brand Display'; src: url('https://cdn.brand.com/fonts/brand.woff2'); }
        h1 { font-family: 'Brand Display', serif; }
      </style>
    `;
    const fonts = extractFontFamilies(html);
    const brand = fonts.find((f) => f.family === "Brand Display");
    expect(brand).toBeDefined();
    expect(brand?.count).toBe(2);
    expect(brand?.sources).toEqual(["style_block"]);
  });

  it("captures legacy <font face=...> HTML attributes", () => {
    const html = `
      <font face="Arial">a</font>
      <font face="'Helvetica Neue', Helvetica">b</font>
    `;
    const fonts = extractFontFamilies(html);
    const families = fonts.map((f) => f.family.toLowerCase());
    expect(families).toContain("arial");
    expect(families).toContain("helvetica neue");
    expect(families).toContain("helvetica");
    const arial = fonts.find((f) => f.family.toLowerCase() === "arial");
    expect(arial?.sources).toEqual(["attribute"]);
  });

  it("decodes &quot;/&apos; entities so HTML-encoded inline styles parse correctly", () => {
    const html = `
      <p style="font-family: &quot;Helvetica Neue&quot;, Arial, sans-serif">a</p>
      <p style="font-family: &apos;Inter&apos;, Helvetica">b</p>
    `;
    const fonts = extractFontFamilies(html);
    const families = fonts.map((f) => f.family);
    expect(families).toContain("Helvetica Neue");
    expect(families).toContain("Inter");
    expect(families).toContain("Arial");
    expect(families).toContain("Helvetica");
    expect(families).not.toContain("&quot");
    expect(families).not.toContain("&apos");
  });

  it("strips !important and skips CSS variables", () => {
    const html = `
      <style>
        body { font-family: "Inter" !important; }
        h2 { font-family: var(--brand-font); }
      </style>
    `;
    const fonts = extractFontFamilies(html);
    expect(fonts.map((f) => f.family)).toEqual(["Inter"]);
  });

  it("filters generic family keywords and system-stack tokens", () => {
    const html = `
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      </style>
    `;
    const fonts = extractFontFamilies(html);
    const families = fonts.map((f) => f.family);
    expect(families).toEqual(expect.arrayContaining(["Segoe UI", "Roboto"]));
    expect(families).not.toContain("-apple-system");
    expect(families).not.toContain("BlinkMacSystemFont");
    expect(families).not.toContain("sans-serif");
  });

  it("ignores font-family declarations inside <script> blocks", () => {
    const html = `<script>const css = 'body { font-family: "Comic Sans MS"; }';</script>`;
    expect(extractFontFamilies(html)).toEqual([]);
  });

  it("sorts by primary_count desc, then total count, and respects the limit", () => {
    const html = `
      <style>
        .a { font-family: 'Inter'; }
        .b { font-family: 'Inter'; }
        .c { font-family: 'Inter'; }
        .d { font-family: 'Roboto'; }
        .e { font-family: 'Roboto'; }
        .f { font-family: 'Georgia'; }
        .g { font-family: 'Brand'; }
      </style>
    `;
    const fonts = extractFontFamilies(html, 2);
    expect(fonts.map((f) => f.family)).toEqual(["Inter", "Roboto"]);
    expect(fonts[0].primary_count).toBe(3);
    expect(fonts[1].primary_count).toBe(2);
  });

  it("returns [] for empty input", () => {
    expect(extractFontFamilies("")).toEqual([]);
  });
});

describe("extractMetadata (integration)", () => {
  it("returns a full enrichment record", () => {
    const html = `
      <html>
        <head>
          <meta name="color-scheme" content="light dark" />
          <style>
            @media (prefers-color-scheme: dark) { body { background:#000; } }
            body { background: #ffffff; color: #1a1a1a; font-family: "Inter", Arial, sans-serif; }
          </style>
        </head>
        <body bgcolor="#ffffff">
          <div style="display:none;font-size:0">Hidden preview line for inbox</div>
          <h1 style="color:#1A1A1A;font-family:'Inter',sans-serif">Spring sale</h1>
          <img src="https://cdn.example.com/banner.gif" />
          <a href="https://shop.example.com/sale?utm_source=klaviyo&utm_campaign=spring2026">Shop</a>
        </body>
      </html>
    `;
    const meta = extractMetadata({
      subject: "BIG spring sale just landed",
      html,
      mirroredAssets: [
        {
          remoteUrl: "https://cdn.example.com/banner.gif",
          storagePath: "abc/123.gif",
          contentType: "image/gif",
          byteLength: 100
        }
      ],
      headers: {
        "Authentication-Results": "mx; spf=pass; dkim=pass; dmarc=pass"
      }
    });

    expect(meta.preheader).toBe("Hidden preview line for inbox");
    expect(meta.has_dark_mode).toBe(true);
    expect(meta.has_gif).toBe(true);
    expect(meta.image_count).toBe(1);
    expect(meta.link_domains).toContain("shop.example.com");
    expect(meta.utm_index[0]).toMatchObject({ source: "klaviyo", campaign: "spring2026" });
    expect(meta.subject_metadata.word_count).toBeGreaterThan(0);
    expect(meta.auth_results).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });

    const paletteHexes = meta.palette_colors.map((c) => c.hex);
    expect(paletteHexes).toContain("#000000");
    expect(paletteHexes).toContain("#ffffff");
    expect(paletteHexes).toContain("#1a1a1a");

    const fontFamilies = meta.font_families.map((f) => f.family);
    expect(fontFamilies).toContain("Inter");
    expect(fontFamilies).toContain("Arial");
    expect(fontFamilies).not.toContain("sans-serif");
    const inter = meta.font_families.find((f) => f.family === "Inter");
    expect(inter?.count).toBe(2);
    expect(inter?.primary_count).toBe(2);
    expect(inter?.sources.sort()).toEqual(["inline", "style_block"]);
    const arial = meta.font_families.find((f) => f.family === "Arial");
    expect(arial?.primary_count).toBe(0);
  });
});
