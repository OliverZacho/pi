import { describe, expect, it } from "vitest";
import {
  detectDarkMode,
  detectHasGif,
  extractAuthResults,
  extractColorPalette,
  extractFontFamilies,
  extractLinks,
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
    expect(map.get("inter")?.sources.sort()).toEqual(["inline", "style_block"]);
    expect(map.get("helvetica neue")?.count).toBe(1);
    expect(map.get("helvetica")?.count).toBe(1);
    expect(map.get("arial")?.count).toBe(1);
    expect(map.get("georgia")?.count).toBe(1);
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

  it("sorts by frequency descending and respects the limit", () => {
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
    expect(fonts[0].count).toBe(3);
    expect(fonts[1].count).toBe(2);
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
    expect(inter?.sources.sort()).toEqual(["inline", "style_block"]);
  });
});
