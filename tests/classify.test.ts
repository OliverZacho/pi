import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyEmail, countryCodeTld } from "@/lib/classify";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

function anthropicResponse(body: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "tool_use",
          name: "classify_email",
          input: body
        }
      ]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("classifyEmail", () => {
  it("keeps the rules category but still calls the LLM for structured fields when rules confidence is high", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "sale",
        confidence: 0.4,
        reasoning: "Body just has a coupon code.",
        discount_percent: 25,
        discount_amount: null,
        currency: "USD",
        promo_code: "SPRING25",
        primary_cta_text: "Shop the sale",
        primary_cta_url_hint: "shop.example.com/sale"
      })
    );

    const result = await classifyEmail({
      subject: "Introducing our latest sneaker",
      html: "<p>It's now available worldwide.</p>"
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("rules");
    expect(result.category).toBe("product_launch");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.discountPercent).toBe(25);
    expect(result.promoCode).toBe("SPRING25");
    expect(result.primaryCtaText).toBe("Shop the sale");
    expect(result.currency).toBe("USD");
  });

  it("falls back to rules with null structured fields when the Anthropic API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await classifyEmail({
      subject: "hello there",
      html: "<p>just touching base</p>"
    });

    expect(result.source).toBe("rules");
    expect(result.llmError).toMatch(/ANTHROPIC_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.discountPercent).toBeNull();
    expect(result.promoCode).toBeNull();
  });

  it("uses the LLM category when rules confidence is low", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "company_news",
        confidence: 0.92,
        reasoning: "Mentions a hiring milestone.",
        discount_percent: null,
        discount_amount: null,
        currency: null,
        promo_code: null,
        primary_cta_text: null,
        primary_cta_url_hint: null
      })
    );

    const result = await classifyEmail({
      subject: "An update from us",
      html: "<p>here is what changed this week</p>"
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBeDefined();

    expect(result.source).toBe("llm");
    expect(result.category).toBe("company_news");
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.reasoning).toBe("Mentions a hiring milestone.");
    expect(result.model).toBe("claude-haiku-4-5");
  });

  it("clamps and normalizes structured LLM output", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "sale",
        confidence: 0.95,
        reasoning: "Site-wide percent off promo.",
        discount_percent: 250,
        discount_amount: null,
        currency: "usd",
        promo_code: "  SALE40  ",
        primary_cta_text: "Shop now",
        primary_cta_url_hint: "https://shop.example.com/sale"
      })
    );

    const result = await classifyEmail({
      subject: "40% off everything today",
      html: "<p>Use SALE40 — sitewide 40% discount.</p>"
    });

    expect(result.discountPercent).toBe(100);
    expect(result.currency).toBe("USD");
    expect(result.promoCode).toBe("SALE40");
    expect(result.primaryCtaText).toBe("Shop now");
  });

  it("falls back to rules when the LLM returns an unknown category", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "unrecognized",
        confidence: 0.9,
        reasoning: "x"
      })
    );

    const result = await classifyEmail({
      subject: "An update from us",
      html: "<p>here is what changed this week</p>"
    });

    expect(result.source).toBe("rules");
    expect(result.llmError).toMatch(/unknown category/);
    expect(result.discountPercent).toBeNull();
  });

  it("falls back to rules when the LLM endpoint errors", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    const result = await classifyEmail({
      subject: "An update from us",
      html: "<p>nothing in particular</p>"
    });

    expect(result.source).toBe("rules");
    expect(result.llmError).toBe("network down");
    expect(result.discountPercent).toBeNull();
  });

  it("falls back to rules when the LLM response has no tool_use block", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "I won't classify this." }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await classifyEmail({
      subject: "ambiguous",
      html: "<p>nothing</p>"
    });

    expect(result.source).toBe("rules");
    expect(result.llmError).toMatch(/tool_use/);
  });

  it("records a confident detected country with its signals", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "products",
        confidence: 0.95,
        reasoning: "Danish copy, Copenhagen footer address.",
        country: "dk",
        language: "da",
        country_confidence: 0.92,
        country_source: "footer_address"
      })
    );

    const result = await classifyEmail({
      subject: "Nyhed: forårskollektionen er landet",
      html: "<p>Se de nye møbler. Norr11 ApS, København, CVR 12345678.</p>",
      senderDomain: "nyheder@norr11.dk"
    });

    expect(result.detectedCountry).toBe("DK");
    expect(result.countryConfidence).toBeCloseTo(0.92);
    expect(result.countrySignals).toMatchObject({
      language: "da",
      tld: "dk",
      source: "footer_address",
      rawCountry: "DK"
    });
  });

  it("rejects a high-confidence country when the model fakes a tld source on a .com sender", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "products",
        confidence: 0.9,
        reasoning: "English copy from a .com.",
        country: "us",
        language: "en",
        country_confidence: 0.9,
        country_source: "tld"
      })
    );

    const result = await classifyEmail({
      subject: "What's your match?",
      html: "<p>Find your shade.</p>",
      senderDomain: "hello@gisou.com"
    });

    // No real ccTLD was passed, so a "tld" rationale is fabricated → unknown.
    expect(result.detectedCountry).toBeNull();
    expect(result.countrySignals).toMatchObject({ source: "tld", rawCountry: "US", tld: null });
  });

  it("accepts a real ccTLD pick", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "products",
        confidence: 0.9,
        reasoning: "Sender is a .se domain.",
        country: "se",
        language: "en",
        country_confidence: 0.65,
        country_source: "tld"
      })
    );

    const result = await classifyEmail({
      subject: "Nyheter",
      html: "<p>See the collection.</p>",
      senderDomain: "nyheter@brand.se"
    });

    expect(result.detectedCountry).toBe("SE");
    expect(result.countrySignals).toMatchObject({ source: "tld", tld: "se" });
  });

  it("keeps a 'mixed'-source pick with no tld (how genuinely-classified brands are stored)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "products",
        confidence: 0.9,
        reasoning: "Danish footer address plus brand cues.",
        country: "dk",
        language: "en",
        country_confidence: 0.85,
        // The narrow guard only distrusts a fabricated `tld`; `mixed` (the
        // common real-brand label) must be trusted even with no ccTLD.
        country_source: "mixed"
      })
    );

    const result = await classifyEmail({
      subject: "New collection",
      html: "<p>Designed in Copenhagen.</p>",
      senderDomain: "hello@brand.com"
    });

    expect(result.detectedCountry).toBe("DK");
  });

  it("collapses a low-confidence country to unknown but keeps the raw pick", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "content",
        confidence: 0.9,
        reasoning: "Generic English newsletter, no address.",
        country: "us",
        language: "en",
        country_confidence: 0.3,
        country_source: "tld"
      })
    );

    const result = await classifyEmail({
      subject: "This week's reads",
      html: "<p>A few links we liked.</p>",
      senderDomain: "hello@example.com"
    });

    expect(result.detectedCountry).toBeNull();
    expect(result.countryConfidence).toBeCloseTo(0.3);
    expect(result.countrySignals).toMatchObject({ rawCountry: "US", tld: null });
  });
});

describe("countryCodeTld", () => {
  it("extracts a ccTLD from an address or bare domain", () => {
    expect(countryCodeTld("news@norr11.dk")).toBe("dk");
    expect(countryCodeTld("brand.co.uk")).toBe("uk");
    expect(countryCodeTld("Brand <hi@shop.de>")).toBe("de");
  });

  it("returns null for generic / unparseable TLDs", () => {
    expect(countryCodeTld("hello@example.com")).toBeNull();
    expect(countryCodeTld("team@vercel.io")).toBeNull();
    expect(countryCodeTld(undefined)).toBeNull();
    expect(countryCodeTld("localhost")).toBeNull();
  });
});
