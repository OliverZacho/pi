import { describe, expect, it } from "vitest";
import { defaultBrandAccent, pickBrandAccent } from "@/lib/brand-accent";

function entry(hex: string, count = 1) {
  return { hex, count };
}

describe("pickBrandAccent", () => {
  it("returns the navy default when the palette is empty", () => {
    expect(pickBrandAccent([])).toEqual(defaultBrandAccent());
  });

  it("skips near-white palette entries", () => {
    // White is the dominant background for almost every newsletter,
    // so we must never let it become the accent.
    const accent = pickBrandAccent([
      entry("#ffffff", 12),
      entry("#fbfbfb", 8),
      entry("#2563eb", 1)
    ]);
    expect(accent.base).toBe("#2563eb");
  });

  it("skips near-black palette entries", () => {
    const accent = pickBrandAccent([
      entry("#000000", 10),
      entry("#0a0a0a", 6),
      entry("#ef4444", 3)
    ]);
    expect(accent.base).toBe("#ef4444");
  });

  it("skips grey / desaturated entries", () => {
    // #6b7280 is Tailwind slate — visually grey, not a brand color.
    const accent = pickBrandAccent([
      entry("#6b7280", 9),
      entry("#9ca3af", 7),
      entry("#10b981", 2)
    ]);
    expect(accent.base).toBe("#10b981");
  });

  it("skips washed-out pastels", () => {
    // Pale, low-saturation entries are useless as chart fills on a
    // white card surface.
    const accent = pickBrandAccent([
      entry("#fde7e7", 12),
      entry("#fef3c7", 8),
      entry("#0f766e", 3)
    ]);
    expect(accent.base).toBe("#0f766e");
  });

  it("falls back to the default when every entry is filtered out", () => {
    const accent = pickBrandAccent([
      entry("#ffffff", 12),
      entry("#000000", 9),
      entry("#9ca3af", 7)
    ]);
    expect(accent).toEqual(defaultBrandAccent());
  });

  it("picks white text on dark accents", () => {
    const accent = pickBrandAccent([entry("#1e3a8a", 5)]);
    expect(accent.base).toBe("#1e3a8a");
    expect(accent.foreground).toBe("#ffffff");
  });

  it("picks dark text on bright/light accents", () => {
    // Yellow has very high relative luminance — white text on yellow
    // is unreadable, so we should fall back to dark text.
    const accent = pickBrandAccent([entry("#fbbf24", 5)]);
    expect(accent.base).toBe("#fbbf24");
    expect(accent.foreground).toBe("#0f172a");
  });

  it("returns a soft rgba derived from the chosen color", () => {
    const accent = pickBrandAccent([entry("#2563EB", 5)]);
    expect(accent.base).toBe("#2563eb");
    expect(accent.soft).toBe("rgba(37, 99, 235, 0.12)");
  });

  it("honours the palette's existing sort order (most frequent first)", () => {
    // Both colors pass the filters; we take the one that appears first
    // because `design.palette` is pre-sorted by usage count upstream.
    const accent = pickBrandAccent([
      entry("#16a34a", 12),
      entry("#ef4444", 4)
    ]);
    expect(accent.base).toBe("#16a34a");
  });

  it("tolerates uppercase / mixed-case hex input", () => {
    const accent = pickBrandAccent([entry("#FF6600", 3)]);
    expect(accent.base).toBe("#ff6600");
  });

  it("ignores malformed hex entries instead of throwing", () => {
    const accent = pickBrandAccent([
      entry("not-a-color", 5),
      entry("#abc", 4),
      entry("#1e3a8a", 1)
    ]);
    expect(accent.base).toBe("#1e3a8a");
  });
});
