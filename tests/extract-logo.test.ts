import { describe, expect, it } from "vitest";
import {
  LOGO_HEURISTIC_MIN_SCORE,
  scoreLogoCandidatesFromHtml
} from "@/lib/extract-logo";
import type { MirroredImage } from "@/lib/storage";

function asset(partial: Partial<MirroredImage> & Pick<MirroredImage, "remoteUrl" | "storagePath">): MirroredImage {
  return {
    contentType: "image/png",
    byteLength: 12_000,
    ...partial
  };
}

describe("scoreLogoCandidatesFromHtml", () => {
  it("picks the link-wrapped header image labelled 'logo'", () => {
    const html = `
      <html><body>
        <a href="https://acme.com/"><img src="https://cdn.example.com/header/logo.png" alt="Acme Logo" width="120" height="40" /></a>
        <h1>Spring drop</h1>
        <img src="https://cdn.example.com/hero.jpg" alt="Hero" width="600" height="700" />
      </body></html>
    `;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "acme.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/header/logo.png",
          storagePath: "abc/logo.png",
          contentType: "image/png",
          byteLength: 8_000
        }),
        asset({
          remoteUrl: "https://cdn.example.com/hero.jpg",
          storagePath: "abc/hero.jpg",
          contentType: "image/jpeg",
          byteLength: 350_000
        })
      ]
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].storagePath).toBe("abc/logo.png");
    expect(candidates[0].score).toBeGreaterThanOrEqual(LOGO_HEURISTIC_MIN_SCORE);
    expect(candidates[0].reasons).toEqual(
      expect.arrayContaining(["wrapped in link to company domain", 'alt="logo"'])
    );
  });

  it("downranks the hero image even when no logo is labelled", () => {
    const html = `
      <html><body>
        <img src="https://cdn.example.com/header/brand.svg" width="150" height="40" alt="Brand" />
        <img src="https://cdn.example.com/hero.jpg" alt="" width="600" height="700" />
      </body></html>
    `;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/header/brand.svg",
          storagePath: "abc/brand.svg",
          contentType: "image/svg+xml",
          byteLength: 4_000
        }),
        asset({
          remoteUrl: "https://cdn.example.com/hero.jpg",
          storagePath: "abc/hero.jpg",
          contentType: "image/jpeg",
          byteLength: 350_000
        })
      ]
    });
    expect(candidates[0].storagePath).toBe("abc/brand.svg");
  });

  it("ignores images inside the unsubscribe footer", () => {
    const html = `
      <html><body>
        <header>
          <img src="https://cdn.example.com/header/logo.png" alt="logo" width="120" height="40" />
        </header>
        <p>Body content</p>
        <footer>
          <img src="https://cdn.example.com/footer/logo.png" alt="logo" width="60" height="20" />
          <a href="https://example.com/unsubscribe">Unsubscribe</a>
        </footer>
      </body></html>
    `;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "example.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/header/logo.png",
          storagePath: "abc/header-logo.png"
        }),
        asset({
          remoteUrl: "https://cdn.example.com/footer/logo.png",
          storagePath: "abc/footer-logo.png"
        })
      ]
    });
    expect(candidates[0].storagePath).toBe("abc/header-logo.png");
    const footerScore = candidates.find((c) => c.storagePath === "abc/footer-logo.png")?.score ?? 0;
    expect(footerScore).toBeLessThan(candidates[0].score);
  });

  it("ignores 1x1 tracking pixels regardless of byte size", () => {
    const html = `
      <html><body>
        <img src="https://cdn.example.com/header/logo.png" alt="logo" width="100" height="40" />
        <img src="https://cdn.example.com/pixel.gif" width="1" height="1" alt="" />
      </body></html>
    `;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/header/logo.png",
          storagePath: "abc/logo.png"
        }),
        asset({
          remoteUrl: "https://cdn.example.com/pixel.gif",
          storagePath: "abc/pixel.gif",
          contentType: "image/gif",
          byteLength: 80
        })
      ]
    });
    expect(candidates[0].storagePath).toBe("abc/logo.png");
  });

  it("does not penalize unknown byte sizes (byteLength=0) as tracking pixels", () => {
    // The backfill script can't re-fetch every asset just to weigh it, so it
    // calls the scorer with byteLength=0. That must NOT trigger the
    // <200-byte tracking-pixel penalty.
    const html = `
      <html><body>
        <a href="https://brand.com"><img src="https://cdn.example.com/header.png" alt="brand" width="180" height="60" /></a>
      </body></html>
    `;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/header.png",
          storagePath: "abc/header.png",
          contentType: "image/png",
          byteLength: 0
        })
      ]
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons).not.toContain("tracking pixel");
  });

  it("skips images that were not mirrored", () => {
    const html = `
      <html><body>
        <img src="https://cdn.example.com/header/logo.png" alt="logo" width="100" height="40" />
      </body></html>
    `;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: []
    });
    expect(candidates).toEqual([]);
  });

  it("returns an empty list when html has no <img> tags", () => {
    expect(
      scoreLogoCandidatesFromHtml({
        html: "<p>Plain text email</p>",
        companyDomain: "brand.com",
        mirroredAssets: [
          asset({
            remoteUrl: "https://example.com/x.png",
            storagePath: "abc/x.png"
          })
        ]
      })
    ).toEqual([]);
  });
});

describe("scoreLogoCandidatesFromHtml — first-image-in-body bonus", () => {
  it("rewards the first <img> in body even when byte-offset position is past 15%", () => {
    // Simulate the Klaviyo/Mailchimp pattern: lots of head boilerplate and
    // inline CSS pushes the first body image past the byte-offset cutoff,
    // but it's still clearly the first visible image.
    const head = `<style>${"a{color:#000;}".repeat(800)}</style>`;
    const html = `<html><head>${head}</head><body><img src="https://cdn.example.com/logo.png" width="180" height="50" alt="" /><p>Hi there</p></body></html>`;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/logo.png",
          storagePath: "abc/logo.png",
          contentType: "image/png",
          byteLength: 0
        })
      ]
    });
    expect(candidates[0].reasons).toContain("first image in body");
    expect(candidates[0].score).toBeGreaterThanOrEqual(LOGO_HEURISTIC_MIN_SCORE);
  });

  it("does not award the first-in-body bonus to footer images", () => {
    // The only <img> sits inside the footer — even though it's technically
    // the first image, the footer penalty should win and the bonus is
    // suppressed.
    const html = `<html><body><footer><img src="https://cdn.example.com/footer.png" alt="logo" width="120" height="40" /></footer></body></html>`;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/footer.png",
          storagePath: "abc/footer.png"
        })
      ]
    });
    expect(candidates[0].reasons).not.toContain("first image in body");
    expect(candidates[0].reasons).toContain("inside footer/unsubscribe region");
  });
});

describe("scoreLogoCandidatesFromHtml — same-email duplicate bonus", () => {
  it("collapses duplicate <img> tags and adds an 'above-the-fold repeat' bonus", () => {
    // Many emails reference the logo twice in the header (desktop and a
    // responsive/mobile mirror). Strong signal that this is the brand logo.
    const html = `
      <html><body>
        <img src="https://cdn.example.com/header.png" width="180" height="50" alt="" />
        <p>Greeting</p>
        <img src="https://cdn.example.com/header.png" width="200" height="60" alt="" />
        <p>Body text</p>
        <img src="https://cdn.example.com/hero.jpg" width="600" height="700" alt="" />
      </body></html>
    `;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/header.png",
          storagePath: "abc/header.png",
          contentType: "image/png",
          byteLength: 0
        }),
        asset({
          remoteUrl: "https://cdn.example.com/hero.jpg",
          storagePath: "abc/hero.jpg",
          contentType: "image/jpeg",
          byteLength: 0
        })
      ]
    });
    const repeated = candidates.find((c) => c.storagePath === "abc/header.png");
    expect(repeated).toBeDefined();
    expect(repeated!.reasons.some((r) => r.startsWith("repeats"))).toBe(true);
    // The duplicate candidate should be a single row, not two.
    expect(candidates.filter((c) => c.storagePath === "abc/header.png")).toHaveLength(1);
  });

  it("does not apply the duplicate bonus when both occurrences are below the fold", () => {
    // Two appearances late in the email (below the 50% mark) is not a
    // logo signal — could be e.g. a "shop now" CTA that appears twice in
    // the body and footer.
    const padding = "<p>x</p>".repeat(800);
    const html = `<html><body>${padding}<img src="https://cdn.example.com/cta.png" width="200" height="60" alt="" /><p>...</p><img src="https://cdn.example.com/cta.png" width="200" height="60" alt="" /></body></html>`;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/cta.png",
          storagePath: "abc/cta.png"
        })
      ]
    });
    expect(candidates[0].reasons.some((r) => r.startsWith("repeats"))).toBe(false);
  });
});

describe("scoreLogoCandidatesFromHtml — filename signals", () => {
  it("recognizes 'wordmark' in filename as a logo signal", () => {
    const html = `<html><body><img src="https://cdn.example.com/assets/brand-wordmark.svg" width="180" height="40" alt="" /></body></html>`;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/assets/brand-wordmark.svg",
          storagePath: "abc/wordmark.svg",
          contentType: "image/svg+xml"
        })
      ]
    });
    expect(candidates[0].reasons).toContain("filename suggests logo/wordmark");
  });

  it("does NOT match accidental substrings like 'cataloging.png' or 'analogous.png'", () => {
    const html = `<html><body><img src="https://cdn.example.com/cataloging.png" width="180" alt="" /><img src="https://cdn.example.com/analogous-art.png" width="180" alt="" /></body></html>`;
    const candidates = scoreLogoCandidatesFromHtml({
      html,
      companyDomain: "brand.com",
      mirroredAssets: [
        asset({
          remoteUrl: "https://cdn.example.com/cataloging.png",
          storagePath: "abc/cataloging.png"
        }),
        asset({
          remoteUrl: "https://cdn.example.com/analogous-art.png",
          storagePath: "abc/analogous.png"
        })
      ]
    });
    for (const candidate of candidates) {
      expect(candidate.reasons).not.toContain("filename suggests logo/wordmark");
    }
  });
});
