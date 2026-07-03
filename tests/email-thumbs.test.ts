import { describe, expect, it } from "vitest";
import { chooseHeroImagePath } from "@/lib/notifications/email-thumbs";
import { renderDigestEmail } from "@/lib/digest/render";
import type { DigestModel, DigestPick } from "@/lib/digest/build";

const KB = 1024;

describe("chooseHeroImagePath", () => {
  it("picks the largest image above the logo/spacer floor", () => {
    const sizes = {
      "logo.png": 8 * KB,
      "hero.jpg": 400 * KB,
      "banner.jpg": 120 * KB
    };
    expect(
      chooseHeroImagePath(["logo.png", "banner.jpg", "hero.jpg"], sizes)
    ).toBe("hero.jpg");
  });

  it("returns null when every image is logo-sized", () => {
    const sizes = { "logo.png": 8 * KB, "pixel.gif": 1 * KB };
    expect(chooseHeroImagePath(["logo.png", "pixel.gif"], sizes)).toBeNull();
  });

  it("never picks a non-transformable asset", () => {
    const sizes = { "logo.svg": 900 * KB, "hero.jpg": 200 * KB };
    expect(chooseHeroImagePath(["logo.svg", "hero.jpg"], sizes)).toBe(
      "hero.jpg"
    );
    expect(chooseHeroImagePath(["logo.svg"], sizes)).toBeNull();
  });

  it("falls back to the first transformable image without sizes", () => {
    expect(
      chooseHeroImagePath(["logo.svg", "first.jpg", "second.jpg"], undefined)
    ).toBe("first.jpg");
    expect(chooseHeroImagePath([], undefined)).toBeNull();
  });

  it("skips paths missing from the sizes map", () => {
    const sizes = { "known.jpg": 200 * KB };
    expect(chooseHeroImagePath(["deleted.jpg", "known.jpg"], sizes)).toBe(
      "known.jpg"
    );
  });
});

describe("renderDigestEmail pick thumbnails", () => {
  function modelWith(picks: DigestPick[]): DigestModel {
    return {
      cadence: "daily",
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-02T00:00:00.000Z",
      emailCount: picks.length,
      brandCount: picks.length,
      headline: ["Something happened."],
      picks,
      tail: [],
      nothingUnusual: false
    };
  }

  function pick(overrides: Partial<DigestPick>): DigestPick {
    return {
      brandName: "ARKET",
      subject: "New drop",
      day: "Wed",
      why: null,
      kind: "launch",
      emailId: "email-1",
      thumbnailUrl: null,
      ...overrides
    };
  }

  it("renders the preview image linked to the pick", () => {
    const { html } = renderDigestEmail(
      modelWith([pick({ thumbnailUrl: "https://cdn.example/hero.avif" })])
    );
    expect(html).toContain('src="https://cdn.example/hero.avif"');
    expect(html).toContain("/explore?email=email-1");
  });

  it("renders text-only when the pick has no thumbnail", () => {
    const { html } = renderDigestEmail(modelWith([pick({})]));
    expect(html).not.toContain("<img");
  });
});
