import { describe, expect, it, vi } from "vitest";
import { costOf, parseResponse, scoreWithLlm } from "../src/scoring/llm.js";
import type { Job } from "../src/types.js";

function job(over: Partial<Job> = {}): Job {
  return {
    source: "ashby",
    sourceId: "1",
    url: "https://example.com/1",
    title: "Backend Engineer",
    company: "Acme",
    description: "We run Node and Postgres.",
    location: "Remote",
    remote: true,
    salaryText: null,
    postedAt: null,
    fetchedAt: new Date(),
    fingerprint: "",
    postingFingerprint: "",
    raw: null,
    ...over,
  };
}

type Request = { model: string; system: Array<{ cache_control?: unknown }>; messages: Array<{ content: string }> };

/** Minimal stand-in for client.messages: returns the given texts in order. */
function stubClient(texts: string[], stopReason: string | null = "end_turn") {
  const create = vi.fn(async (_request: Request) => ({
    content: [{ type: "text", text: texts.shift() ?? "" }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 80 },
  }));
  return { client: { create } as never, create };
}

const GOOD = JSON.stringify({ fit: 82, reasons: ["ledger work"], concerns: ["US only"] });

describe("parseResponse", () => {
  it("parses a bare object", () => {
    expect(parseResponse(GOOD)).toEqual({ fit: 82, reasons: ["ledger work"], concerns: ["US only"] });
  });

  it("parses a fenced object", () => {
    expect(parseResponse("```json\n" + GOOD + "\n```")?.fit).toBe(82);
  });

  it("parses an object buried in prose", () => {
    expect(parseResponse(`Here is my assessment:\n${GOOD}\nHope that helps.`)?.fit).toBe(82);
  });

  it("returns null for prose with no object", () => {
    expect(parseResponse("I think this job is a good fit, roughly 80 out of 100.")).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(parseResponse('{"fit": 82, "reasons": ["ledg')).toBeNull();
  });

  it("returns null when a field is the wrong type", () => {
    expect(parseResponse('{"fit": "high", "reasons": [], "concerns": []}')).toBeNull();
  });

  it("clamps fit into 0-100 and rounds it", () => {
    expect(parseResponse('{"fit": 140, "reasons": [], "concerns": []}')?.fit).toBe(100);
    expect(parseResponse('{"fit": -5, "reasons": [], "concerns": []}')?.fit).toBe(0);
    expect(parseResponse('{"fit": 72.6, "reasons": [], "concerns": []}')?.fit).toBe(73);
  });

  it("caps reasons and concerns at 3 and drops blanks", () => {
    const parsed = parseResponse(
      JSON.stringify({ fit: 50, reasons: ["a", "b", "c", "d"], concerns: ["x", "  ", "y"] }),
    )!;
    expect(parsed.reasons).toEqual(["a", "b", "c"]);
    expect(parsed.concerns).toEqual(["x", "y"]);
  });
});

describe("scoreWithLlm", () => {
  it("returns the parsed score on a clean first response", async () => {
    const { client, create } = stubClient([GOOD]);
    const result = await scoreWithLlm(job(), "profile text", { client });

    expect(result.fit).toBe(82);
    expect(result.retried).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first response is not JSON", async () => {
    const { client, create } = stubClient(["Sorry, here are my thoughts in prose.", GOOD]);
    const result = await scoreWithLlm(job(), "profile text", { client });

    expect(result.fit).toBe(82);
    expect(result.retried).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    // the retry tells the model what went wrong
    const second = create.mock.calls[1]![0];
    expect(second.messages).toHaveLength(2);
    expect(second.messages[1]!.content).toContain("not valid JSON");
  });

  it("gives up after one retry", async () => {
    const { client, create } = stubClient(["nope", "still nope"]);
    await expect(scoreWithLlm(job(), "profile", { client })).rejects.toThrow(/valid JSON after a retry/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("sums usage across both attempts", async () => {
    const { client } = stubClient(["nope", GOOD]);
    const result = await scoreWithLlm(job(), "profile", { client });
    expect(result.usage.inputTokens).toBe(200);
    expect(result.usage.outputTokens).toBe(40);
    expect(result.usage.cacheReadTokens).toBe(160);
  });

  it("throws rather than retrying when the model refuses", async () => {
    const { client, create } = stubClient(["", GOOD], "refusal");
    await expect(scoreWithLlm(job(), "profile", { client })).rejects.toThrow(/refused/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends the profile and the job, and marks the system block cacheable", async () => {
    const { client, create } = stubClient([GOOD]);
    await scoreWithLlm(job({ company: "Distinctive Co" }), "PROFILE MARKER", { client });

    const request = create.mock.calls[0]![0];
    expect(request.model).toBe("claude-sonnet-4-6");
    expect(request.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(request.messages[0]!.content).toContain("PROFILE MARKER");
    expect(request.messages[0]!.content).toContain("Distinctive Co");
  });

  it("truncates a very long description rather than sending it whole", async () => {
    const { client, create } = stubClient([GOOD]);
    await scoreWithLlm(job({ description: "x".repeat(50_000) }), "profile", { client });

    const request = create.mock.calls[0]![0];
    expect(request.messages[0]!.content).toContain("[description truncated]");
    expect(request.messages[0]!.content.length).toBeLessThan(20_000);
  });
});

describe("costOf", () => {
  it("prices input, output and cache at their own rates", () => {
    // 1M input at $3 + 1M output at $15
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(3);
    expect(costOf({ inputTokens: 0, outputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(15);
    expect(costOf({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 0 })).toBeCloseTo(3.75);
    expect(costOf({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.3);
  });
});
