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
  it("matches sale / discount keywords", () => {
    const result = classifyFromRules("Massive sale today!", "<p>20% off everything</p>");
    expect(result.category).toBe("sale");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("matches product launch keywords", () => {
    const result = classifyFromRules("Introducing our new product", "<p>now available worldwide</p>");
    expect(result.category).toBe("product_launch");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("matches event / invite keywords", () => {
    const result = classifyFromRules("You're invited", "<p>RSVP for our launch event next week.</p>");
    expect(result.category).toBe("event");
  });

  it("matches seasonal campaign keywords", () => {
    const result = classifyFromRules("Black Friday is here", "<p>Biggest deals of the year.</p>");
    expect(result.category).toBe("seasonal");
  });

  it("matches loyalty / retention keywords", () => {
    const result = classifyFromRules("We miss you", "<p>Come back and use your rewards.</p>");
    expect(result.category).toBe("loyalty");
  });

  it("matches welcome / onboarding keywords", () => {
    const result = classifyFromRules(
      "Welcome to Acme",
      "<p>Thanks for signing up — here's how to get started.</p>"
    );
    expect(result.category).toBe("welcome");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("keeps 'welcome back' as a loyalty signal, not welcome onboarding", () => {
    const result = classifyFromRules(
      "Welcome back",
      "<p>We miss you — come back and use your rewards.</p>"
    );
    expect(result.category).toBe("loyalty");
  });

  it("prefers welcome over sale when the subject is a signup greeting with a signup discount", () => {
    const result = classifyFromRules(
      "Welcome to STINE GOYA",
      "<p>10% off your first order with code GOYAFRIEND.</p>"
    );
    expect(result.category).toBe("welcome");
    expect(result.confidence).toBeGreaterThan(0.85);
  });

  it("treats Scandinavian 'velkommen til <brand>' subjects as welcome even with a gift inside", () => {
    const result = classifyFromRules(
      "Bird, velkommen til GANNI",
      "<p>Vi har en gave til dig — 15% off din første ordre.</p>"
    );
    expect(result.category).toBe("welcome");
  });

  it("treats a standalone 'Welcome!' subject as welcome, not sale", () => {
    const result = classifyFromRules(
      "Welcome!",
      "<p>Ready to discover a universe of new perspectives — enjoy a 10% off discount on us.</p>"
    );
    expect(result.category).toBe("welcome");
  });

  it("matches product showcase keywords as 'products'", () => {
    const result = classifyFromRules(
      "Shop the new collection",
      "<p>Our latest styles are here — new arrivals waiting for you.</p>"
    );
    expect(result.category).toBe("products");
  });

  it("prefers 'sale' over 'products' when a discount headline is present", () => {
    const result = classifyFromRules(
      "Shop the new collection — 30% off",
      "<p>New arrivals and 30% off everything sitewide.</p>"
    );
    expect(result.category).toBe("sale");
  });

  it("matches partnership keywords", () => {
    const result = classifyFromRules("Big news", "<p>We're teaming up with Nike on a collaboration.</p>");
    expect(result.category).toBe("partnership");
  });

  it("matches company news keywords", () => {
    const result = classifyFromRules("A milestone for us", "<p>We're now hiring across the team.</p>");
    expect(result.category).toBe("company_news");
  });

  it("does not let deliverability boilerplate hijack the category", () => {
    // "to ensure receipt of our emails, please add us to your address book" is
    // standard allowlist chrome — it must not pull a marketing email into a
    // receipt/transactional bucket (which no longer exists).
    const result = classifyFromRules(
      "Welcome to Acme",
      "<p>Glad you're here. To ensure receipt of our emails, please add us to your address book.</p>"
    );
    expect(result.category).toBe("welcome");
  });

  it("matches editorial / content keywords", () => {
    const result = classifyFromRules("Weekly newsletter", "<p>This week's edition of our insights.</p>");
    expect(result.category).toBe("content");
  });

  it("matches education / how-to keywords", () => {
    const result = classifyFromRules(
      "How to charge your EV at home",
      "<p>A step-by-step tutorial for first-time owners.</p>"
    );
    expect(result.category).toBe("education");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("matches survey / feedback keywords", () => {
    const result = classifyFromRules(
      "Got 2 minutes? Share your feedback",
      "<p>Take our short survey and help us improve.</p>"
    );
    expect(result.category).toBe("survey");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("falls back to 'other' when no keywords match", () => {
    const result = classifyFromRules("hello", "<p>just a note</p>");
    expect(result.category).toBe("other");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("ignores 'promotional newsletter' boilerplate in the unsubscribe footer", () => {
    // Real-world false positive: Muuto event invite where the only token from
    // the sale rule was "promotional" in the GDPR/unsubscribe footer.
    const result = classifyFromRules(
      "You're invited—3daysofdesign 2026",
      `<p>Celebrating 20 Years of New Perspectives. Join us in Copenhagen, June 10-12.</p>
       <p>RSVP and explore the program.</p>
       <p style="font-size:10px">You are receiving this email because you are signed up to receive our promotional newsletter.
       At Muuto, we comply with the GDPR. <a href="...">Unsubscribe</a></p>`
    );
    expect(result.category).toBe("event");
  });

  it("does not classify a content email as sale just because the nav links to a /sale page", () => {
    // Common pattern: brand newsletter with a global header nav containing an
    // "Outlet" link to /sale — body otherwise has no sale signal.
    const result = classifyFromRules(
      "This week at Acme",
      `<nav><a href="https://acme.com/new">New</a><a href="https://acme.com/sale">Outlet</a></nav>
       <p>Read our latest story about craftsmanship — our story this week.</p>`
    );
    expect(result.category).not.toBe("sale");
  });

  it("still classifies as sale when the body has a strong discount signal", () => {
    const result = classifyFromRules(
      "An update from us",
      "<p>Sale ends tonight — enjoy 20% off everything sitewide with promo code SAVE20.</p>"
    );
    expect(result.category).toBe("sale");
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
