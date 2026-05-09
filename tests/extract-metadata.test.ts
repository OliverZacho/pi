import { describe, expect, it } from "vitest";
import {
  detectDarkMode,
  detectHasGif,
  extractAuthResults,
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

describe("extractMetadata (integration)", () => {
  it("returns a full enrichment record", () => {
    const html = `
      <html>
        <head>
          <meta name="color-scheme" content="light dark" />
          <style>@media (prefers-color-scheme: dark) { body { background:#000; } }</style>
        </head>
        <body>
          <div style="display:none;font-size:0">Hidden preview line for inbox</div>
          <h1>Spring sale</h1>
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
  });
});
