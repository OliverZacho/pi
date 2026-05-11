import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SuggestCompaniesError,
  normalizeDomain,
  suggestCompanies
} from "@/lib/suggest-companies";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.ANTHROPIC_SUGGEST_MODEL = "claude-haiku-4-5";
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

function anthropicResponse(candidates: unknown[]): Response {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "tool_use",
          name: "suggest_companies",
          input: { candidates }
        }
      ]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("normalizeDomain", () => {
  it("strips protocol, www, paths and lowercases", () => {
    expect(normalizeDomain("HTTPS://www.Aesop.com/au/skincare")).toBe("aesop.com");
    expect(normalizeDomain("  ganni.com  ")).toBe("ganni.com");
    expect(normalizeDomain("https://Stine-Goya.dk?utm=1")).toBe("stine-goya.dk");
  });

  it("rejects values without a dot or with junk", () => {
    expect(normalizeDomain("localhost")).toBe("");
    expect(normalizeDomain("")).toBe("");
    expect(normalizeDomain(null)).toBe("");
    expect(normalizeDomain(123 as unknown)).toBe("");
  });
});

describe("suggestCompanies", () => {
  it("throws missing_api_key when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(suggestCompanies({ market: "fashion" })).rejects.toMatchObject({
      code: "missing_api_key"
    });
  });

  it("normalizes domains, drops excluded and duplicate domains, and clamps to count", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse([
        {
          name: "Ganni",
          domain: "https://www.Ganni.com/dk",
          country: "dk",
          why_relevant: "Premium Danish ready-to-wear with consistent campaigns."
        },
        {
          name: "Stine Goya",
          domain: "stinegoya.com",
          country: "DK",
          why_relevant: "Vibrant prints, active newsletter."
        },
        {
          name: "Ganni Duplicate",
          domain: "ganni.com",
          country: "DK",
          why_relevant: "duplicate; should be ignored"
        },
        {
          name: "Aiayu",
          domain: "aiayu.com",
          country: null,
          why_relevant: "Sustainable Scandinavian basics."
        },
        {
          name: "Extra",
          domain: "extra.com",
          country: "DK",
          why_relevant: "would push past count"
        }
      ])
    );

    const result = await suggestCompanies({
      market: "scandinavian fashion",
      count: 3,
      excludeDomains: ["STINEGOYA.com"]
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const requestInit = init as RequestInit;
    expect((requestInit.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");

    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((c) => c.domain)).toEqual([
      "ganni.com",
      "aiayu.com",
      "extra.com"
    ]);
    expect(result.candidates[0].country).toBe("DK");
    expect(result.candidates[1].country).toBeNull();
  });

  it("clamps the returned list to the requested count", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse([
        { name: "A", domain: "a.com", country: "DK", why_relevant: "x" },
        { name: "B", domain: "b.com", country: "DK", why_relevant: "x" },
        { name: "C", domain: "c.com", country: "DK", why_relevant: "x" }
      ])
    );

    const result = await suggestCompanies({ market: "fashion", count: 2 });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.domain)).toEqual(["a.com", "b.com"]);
  });

  it("throws llm_http on a non-2xx anthropic response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429 })
    );

    await expect(
      suggestCompanies({ market: "fashion" })
    ).rejects.toMatchObject({ code: "llm_http" });
  });

  it("throws llm_format when there is no tool_use block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "no tool" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(
      suggestCompanies({ market: "fashion" })
    ).rejects.toMatchObject({ code: "llm_format" });
  });

  it("throws on empty market input", async () => {
    await expect(
      suggestCompanies({ market: "   " })
    ).rejects.toBeInstanceOf(SuggestCompaniesError);
  });

  it("wraps a network error as llm_unknown", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    await expect(
      suggestCompanies({ market: "fashion" })
    ).rejects.toMatchObject({ code: "llm_unknown", message: "network down" });
  });
});
