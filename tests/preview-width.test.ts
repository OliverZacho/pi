import { describe, expect, it } from "vitest";
import {
  clampNaturalWidth,
  MAX_RENDER_WIDTH,
  PREVIEW_FRAME_SANDBOX,
  RENDER_WIDTH
} from "@/lib/preview-width";

describe("preview frame sandbox", () => {
  it("runs scripts without granting an origin", () => {
    const flags = PREVIEW_FRAME_SANDBOX.split(/\s+/);
    expect(flags).toContain("allow-scripts");
    expect(flags).not.toContain("allow-same-origin");
    expect(flags).not.toContain("allow-forms");
    expect(flags).not.toContain("allow-top-navigation");
  });
});

describe("clampNaturalWidth", () => {
  it("keeps widths inside the render bounds", () => {
    expect(clampNaturalWidth(720)).toBe(720);
    expect(clampNaturalWidth(320)).toBe(RENDER_WIDTH);
    expect(clampNaturalWidth(4000)).toBe(MAX_RENDER_WIDTH);
  });

  it("rejects anything that is not a positive finite number", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "700", null, undefined, {}]) {
      expect(clampNaturalWidth(value)).toBeNull();
    }
  });
});
