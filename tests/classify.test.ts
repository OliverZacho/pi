import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyEmail } from "@/lib/classify";

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
});
