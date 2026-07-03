import { describe, expect, it } from "vitest";
import { chooseHeroImagePath } from "@/lib/notifications/email-thumbs";
import { renderDigestEmail } from "@/lib/digest/render";
import type { DigestModel, DigestPick } from "@/lib/digest/build";

const KB = 1024;

describe("chooseHeroImagePath", () => {
  it("picks the first image above the logo/spacer floor, in document order", () => {
    const sizes = {
      "logo.png": 8 * KB,
      "opening.jpg": 120 * KB,
      "mid-product.jpg": 400 * KB
    };
    // Not the largest — the first one big enough is the email's visible top.
    expect(
      chooseHeroImagePath(["logo.png", "opening.jpg", "mid-product.jpg"], sizes)
    ).toBe("opening.jpg");
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

  it("only picks a GIF when no static image qualifies", () => {
    const sizes = { "anim.gif": 500 * KB, "still.jpg": 100 * KB };
    expect(chooseHeroImagePath(["anim.gif", "still.jpg"], sizes)).toBe(
      "still.jpg"
    );
    expect(chooseHeroImagePath(["anim.gif"], sizes)).toBe("anim.gif");
  });

  it("skips paths with unknown sizes", () => {
    const sizes = { "known.jpg": 200 * KB };
    expect(chooseHeroImagePath(["unmeasured.jpg", "known.jpg"], sizes)).toBe(
      "known.jpg"
    );
    expect(chooseHeroImagePath(["unmeasured.jpg"], sizes)).toBeNull();
  });
});

describe("renderDigestEmail pick previews", () => {
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

  it("renders the banner preview linked to the pick", () => {
    const { html } = renderDigestEmail(
      modelWith([pick({ thumbnailUrl: "https://cdn.example/hero.avif" })])
    );
    expect(html).toContain('src="https://cdn.example/hero.avif"');
    expect(html).toContain("/explore?email=email-1");
    // Full-width banner under the copy, not a fixed-height side column.
    expect(html).toContain('width="552"');
  });

  it("renders text-only when the pick has no thumbnail", () => {
    const { html } = renderDigestEmail(modelWith([pick({})]));
    expect(html).not.toContain("<img");
  });
});
