import { describe, expect, it } from "vitest";
import { rewriteEmailHtml, stripEmailLinks } from "@/lib/email-render";

const MIRROR_MAP = {
  "https://cdn.example.com/banner.png": "em-1/abc.png",
  "https://cdn.example.com/products/shoe.jpg": "em-1/def.jpg"
};

const SIGNED_ASSETS = {
  "em-1/abc.png": "https://signed.supabase.co/em-1/abc.png?token=banner",
  "em-1/def.jpg": "https://signed.supabase.co/em-1/def.jpg?token=shoe"
};

describe("rewriteEmailHtml", () => {
  it("returns an empty result for empty html", () => {
    const result = rewriteEmailHtml("", { mirrorMap: MIRROR_MAP, signedAssets: SIGNED_ASSETS });
    expect(result).toEqual({ html: "", rewritten: 0, total: 0, linksStripped: 0 });
  });

  it("rewrites img src using the mirror map", () => {
    const html = '<p>hi</p><img src="https://cdn.example.com/banner.png" alt="banner" />';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.rewritten).toBe(1);
    expect(result.total).toBe(1);
    expect(result.html).toContain("https://signed.supabase.co/em-1/abc.png?token=banner");
    expect(result.html).not.toContain("cdn.example.com/banner.png");
  });

  it("rewrites srcset entries while keeping descriptors", () => {
    const html =
      '<img src="https://cdn.example.com/banner.png" srcset="https://cdn.example.com/banner.png 1x, https://cdn.example.com/products/shoe.jpg 2x" />';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.html).toContain(
      "srcset=\"https://signed.supabase.co/em-1/abc.png?token=banner 1x, https://signed.supabase.co/em-1/def.jpg?token=shoe 2x\""
    );
  });

  it("falls back to filename matching when only the path differs", () => {
    const html =
      '<img src="https://different.cdn.example.net/cache/banner.png" />' +
      '<img src="https://different.cdn.example.net/path/shoe.jpg?v=2" />';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.html).toContain("https://signed.supabase.co/em-1/abc.png?token=banner");
    expect(result.html).toContain("https://signed.supabase.co/em-1/def.jpg?token=shoe");
    expect(result.rewritten).toBe(2);
  });

  it("rewrites url() references inside <style> blocks", () => {
    const html = `<style>.hero { background: url('https://cdn.example.com/banner.png'); }</style><img src="https://cdn.example.com/banner.png" />`;
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.html).toContain("url('https://signed.supabase.co/em-1/abc.png?token=banner')");
    expect(result.rewritten).toBeGreaterThanOrEqual(2);
  });

  it("rewrites url() references inside inline style attributes", () => {
    const html =
      '<td style="background: url(https://cdn.example.com/banner.png) no-repeat;">hi</td>';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.html).toContain("https://signed.supabase.co/em-1/abc.png?token=banner");
  });

  it("ignores data: and cid: urls", () => {
    const html = '<img src="data:image/png;base64,AAAA" /><img src="cid:embedded@x" />';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.html).toContain("data:image/png;base64,AAAA");
    expect(result.html).toContain("cid:embedded@x");
    expect(result.rewritten).toBe(0);
  });

  it("leaves unmapped urls untouched", () => {
    const html = '<img src="https://stranger.example.com/missing.png" />';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.html).toContain("https://stranger.example.com/missing.png");
    expect(result.rewritten).toBe(0);
    expect(result.total).toBe(1);
  });

  it("strips href, ping, and form action so previews cannot navigate away", () => {
    const html =
      '<a href="https://list.example/unsub?u=42" ping="https://t.example/p">Unsubscribe</a>' +
      '<area shape="rect" coords="0,0,10,10" href="https://list.example/prefs" alt="prefs" />' +
      '<form action="https://list.example/optout" method="post"><button>Opt out</button></form>';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS
    });
    expect(result.html).not.toContain("list.example");
    expect(result.html).not.toContain("t.example");
    expect(result.html).toContain(">Unsubscribe</a>");
    expect(result.html).toContain("<area");
    expect(result.html).toContain("<form");
    expect(result.html).toContain("Opt out");
    expect(result.linksStripped).toBe(4);
  });

  it("keeps links intact when stripLinks is explicitly disabled", () => {
    const html =
      '<a href="https://list.example/unsub?u=42">Unsubscribe</a>' +
      '<form action="https://list.example/optout"><button>Opt out</button></form>';
    const result = rewriteEmailHtml(html, {
      mirrorMap: MIRROR_MAP,
      signedAssets: SIGNED_ASSETS,
      stripLinks: false
    });
    expect(result.html).toContain('href="https://list.example/unsub?u=42"');
    expect(result.html).toContain('action="https://list.example/optout"');
    expect(result.linksStripped).toBe(0);
  });
});

describe("stripEmailLinks", () => {
  it("removes href from anchors but keeps the inner content", () => {
    const html = '<a href="https://x.test/u" target="_blank"><img src="logo.png" alt="x"/></a>';
    const result = stripEmailLinks(html);
    expect(result.html).not.toContain("https://x.test/u");
    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain('<img src="logo.png" alt="x"/>');
    expect(result.stripped).toBe(1);
  });

  it("handles single-quoted and unquoted hrefs", () => {
    const single = stripEmailLinks("<a href='https://x.test/single'>a</a>");
    const unquoted = stripEmailLinks("<a href=https://x.test/unquoted>b</a>");
    expect(single.html).not.toContain("https://x.test/single");
    expect(unquoted.html).not.toContain("https://x.test/unquoted");
    expect(single.stripped).toBe(1);
    expect(unquoted.stripped).toBe(1);
  });

  it("does not touch <link rel='stylesheet'> hrefs", () => {
    const html = '<link rel="stylesheet" href="https://cdn.example/style.css" />';
    const result = stripEmailLinks(html);
    expect(result.html).toContain("https://cdn.example/style.css");
    expect(result.stripped).toBe(0);
  });

  it("ignores tags whose name only starts with a target letter", () => {
    const html = '<address class="x">123 Main St</address><article>hi</article>';
    const result = stripEmailLinks(html);
    expect(result.html).toBe(html);
    expect(result.stripped).toBe(0);
  });

  it("returns an empty result for empty html", () => {
    expect(stripEmailLinks("")).toEqual({ html: "", stripped: 0 });
  });
});
