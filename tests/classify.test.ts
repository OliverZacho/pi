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

function anthropicResponse(body: {
  category?: string;
  confidence?: number;
  reasoning?: string;
}): Response {
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
  it("uses the rules result and skips the LLM when rules confidence is high", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await classifyEmail({
      subject: "Introducing our latest sneaker",
      html: "<p>It's now available worldwide.</p>"
    });

    expect(result.source).toBe("rules");
    expect(result.category).toBe("new_launch");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to rules when the Anthropic API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await classifyEmail({
      subject: "hello there",
      html: "<p>just touching base</p>"
    });

    expect(result.source).toBe("rules");
    expect(result.llmError).toMatch(/ANTHROPIC_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the LLM when rules confidence is low and uses its category", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      anthropicResponse({
        category: "product_update",
        confidence: 0.92,
        reasoning: "Mentions release notes."
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
    expect(result.category).toBe("product_update");
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.reasoning).toBe("Mentions release notes.");
    expect(result.model).toBe("claude-haiku-4-5");
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
