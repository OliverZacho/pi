import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SuggestCompaniesError,
  normalizeDomain,
  suggestCompanies,
  verifyDomains
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
          country: "DK",
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
    expect(result.candidates[1].country).toBe("DK");
  });

  it("drops candidates outside Denmark, Sweden, or Norway", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse([
        { name: "Ganni", domain: "ganni.com", country: "DK", why_relevant: "ok" },
        { name: "Acne Studios", domain: "acnestudios.com", country: "SE", why_relevant: "ok" },
        { name: "Norse Projects", domain: "norseprojects.com", country: "DK", why_relevant: "ok" },
        { name: "Norwegian Wool", domain: "norwegianwool.com", country: "NO", why_relevant: "ok" },
        { name: "Aritzia", domain: "aritzia.com", country: "CA", why_relevant: "should be filtered" },
        { name: "Everlane", domain: "everlane.com", country: "US", why_relevant: "should be filtered" },
        { name: "Toteme", domain: "toteme-studio.com", country: "se", why_relevant: "lowercase ok" }
      ])
    );

    const result = await suggestCompanies({ market: "fashion", count: 20 });

    const domains = result.candidates.map((c) => c.domain);
    expect(domains).toContain("ganni.com");
    expect(domains).toContain("acnestudios.com");
    expect(domains).toContain("norseprojects.com");
    expect(domains).toContain("norwegianwool.com");
    expect(domains).toContain("toteme-studio.com");
    expect(domains).not.toContain("aritzia.com");
    expect(domains).not.toContain("everlane.com");

    const toteme = result.candidates.find((c) => c.domain === "toteme-studio.com");
    expect(toteme?.country).toBe("SE");
  });

  it("accepts a candidate with a Nordic TLD when country is unknown but rejects unknown .com", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse([
        { name: "Skjorten", domain: "skjorten.dk", country: null, why_relevant: "ok" },
        { name: "Något", domain: "nagot.se", country: null, why_relevant: "ok" },
        { name: "Mystery Brand", domain: "mystery-brand.com", country: null, why_relevant: "drop me" }
      ])
    );

    const result = await suggestCompanies({ market: "fashion", count: 10 });
    const domains = result.candidates.map((c) => c.domain);
    expect(domains).toEqual(["skjorten.dk", "nagot.se"]);
  });

  it("includes user_location and Scandinavian scope in the request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse([
        { name: "A", domain: "a.dk", country: "DK", why_relevant: "ok" }
      ])
    );

    await suggestCompanies({ market: "specialty coffee" });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as {
      tools: Array<{
        type?: string;
        name?: string;
        user_location?: { country?: string; city?: string };
      }>;
      system: string;
      messages: Array<{ role: string; content: string }>;
    };

    const webTool = body.tools.find((t) => t.type === "web_search_20250305");
    expect(webTool?.user_location?.country).toBe("DK");
    expect(webTool?.user_location?.city).toBe("Copenhagen");
    expect(body.system).toMatch(/DENMARK, SWEDEN, or NORWAY/);
    expect(body.messages[0].content).toMatch(/Denmark, Sweden, Norway ONLY/);
  });

  it("sends the web_search tool to Anthropic by default", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse([
        { name: "A", domain: "a.com", country: "DK", why_relevant: "x" }
      ])
    );

    await suggestCompanies({ market: "fashion" });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as {
      tools: Array<{ type?: string; name?: string }>;
      tool_choice: { type: string };
      system: string;
    };

    expect(body.tools.some((t) => t.type === "web_search_20250305")).toBe(true);
    expect(body.tools.some((t) => t.name === "suggest_companies")).toBe(true);
    expect(body.tool_choice.type).toBe("auto");
    expect(body.system).toMatch(/web_search/i);
  });

  it("omits the web_search tool when PIROL_SUGGEST_WEB_SEARCH is disabled", async () => {
    process.env.PIROL_SUGGEST_WEB_SEARCH = "false";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse([
        { name: "A", domain: "a.com", country: "DK", why_relevant: "x" }
      ])
    );

    await suggestCompanies({ market: "fashion" });

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as {
      tools: Array<{ type?: string; name?: string }>;
      system: string;
    };

    expect(body.tools.some((t) => t.type === "web_search_20250305")).toBe(false);
    expect(body.tools.some((t) => t.name === "suggest_companies")).toBe(true);
    expect(body.system).toMatch(/do not have web search/i);
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

describe("verifyDomains", () => {
  it("keeps real domains and drops unreachable ones", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("real.com")) {
          return new Response("", { status: 200 });
        }
        if (url.includes("forbidden.com")) {
          return new Response("", { status: 403 });
        }
        if (url.includes("server-error.com")) {
          return new Response("", { status: 503 });
        }
        const err = new Error("getaddrinfo ENOTFOUND fake-brand.example");
        throw err;
      }
    );

    const result = await verifyDomains(
      ["real.com", "forbidden.com", "server-error.com", "fake-brand.example", "REAL.com"],
      { timeoutMs: 1000, concurrency: 4 }
    );

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.kept.sort()).toEqual(["forbidden.com", "real.com"]);
    expect(result.dropped.sort()).toEqual(["fake-brand.example", "server-error.com"]);

    const realCheck = result.verifications.find((v) => v.domain === "real.com");
    expect(realCheck?.ok).toBe(true);
    expect(realCheck?.status).toBe(200);

    const fakeCheck = result.verifications.find(
      (v) => v.domain === "fake-brand.example"
    );
    expect(fakeCheck?.ok).toBe(false);
    expect(fakeCheck?.reason).toBe("dns_not_found");
  });

  it("treats fetch timeouts as a dropped domain", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    );

    const result = await verifyDomains(["slow.example"], { timeoutMs: 30 });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toEqual(["slow.example"]);
    expect(
      result.verifications.find((v) => v.domain === "slow.example")?.reason
    ).toBe("timeout");
  });

  it("normalizes and deduplicates inputs", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    const result = await verifyDomains(
      [
        "https://Ganni.com/",
        "ganni.com",
        "https://www.Ganni.COM/dk",
        "",
        "no-tld",
        null as unknown as string
      ],
      { concurrency: 2 }
    );

    expect(result.verifications).toHaveLength(1);
    expect(result.kept).toEqual(["ganni.com"]);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
