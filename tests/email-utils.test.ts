import { describe, expect, it } from "vitest";
import {
  buildUniqueSubscriptionEmail,
  classifyFromRules,
  extractImageUrlsFromHtml,
  normalizeCompanyName
} from "@/lib/email-utils";

describe("normalizeCompanyName", () => {
  it("lowercases, strips non-alphanumerics, and collapses to single hyphens", () => {
    expect(normalizeCompanyName("Acme Co!")).toBe("acme-co");
    expect(normalizeCompanyName("  __FOO__bar++  ")).toBe("foo-bar");
    expect(normalizeCompanyName("")).toBe("");
  });
});

describe("buildUniqueSubscriptionEmail", () => {
  const fixedNow = new Date("2026-05-07T12:00:00Z");

  it("generates a deterministic prefix from the company name and date", () => {
    expect(buildUniqueSubscriptionEmail("Nike", [], fixedNow)).toBe("nike-20260507@pirol.app");
  });

  it("falls back to 'company' when the name has no usable characters", () => {
    expect(buildUniqueSubscriptionEmail("!!!", [], fixedNow)).toBe("company-20260507@pirol.app");
  });

  it("appends a numeric suffix when the candidate already exists", () => {
    const existing = ["nike-20260507@pirol.app", "nike-20260507-1@pirol.app"];
    expect(buildUniqueSubscriptionEmail("Nike", existing, fixedNow)).toBe(
      "nike-20260507-2@pirol.app"
    );
  });
});

describe("classifyFromRules", () => {
  it("matches sale keywords", () => {
    const result = classifyFromRules("Massive sale today!", "<p>20% off everything</p>");
    expect(result.category).toBe("sale");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("matches launch keywords", () => {
    const result = classifyFromRules("Introducing our new product", "<p>new launch</p>");
    expect(result.category).toBe("new_launch");
  });

  it("falls back to 'other' when no keywords match", () => {
    const result = classifyFromRules("hello", "<p>just a note</p>");
    expect(result.category).toBe("other");
    expect(result.confidence).toBeLessThan(0.5);
  });
});

describe("extractImageUrlsFromHtml", () => {
  it("returns every src attribute of img tags", () => {
    const html = `<p>Hi</p><img src="https://cdn.example.com/a.png" /><img src='https://cdn.example.com/b.jpg'>`;
    expect(extractImageUrlsFromHtml(html)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.jpg"
    ]);
  });

  it("handles html with no images", () => {
    expect(extractImageUrlsFromHtml("<p>nothing</p>")).toEqual([]);
  });
});
