import { describe, expect, it } from "vitest";
import type { Row } from "../app/db";
import {
  EMPTY,
  QUEUE_FLOOR,
  apply,
  countActive,
  facets,
  fromParams,
  toParams,
  type Filters,
} from "../app/filters";

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

function row(over: Partial<Row> = {}): Row {
  return {
    fingerprint: Math.random().toString(16).slice(2),
    title: "Backend Engineer",
    company: "Acme",
    url: "https://example.com",
    source: "ashby",
    sources: ["ashby"],
    salary_text: null,
    posted_at: new Date(NOW - HOUR).toISOString(),
    remote: false,
    score: 50,
    fit: null,
    locations: ["Remote, Global"],
    postings: 1,
    signals: [],
    note: null,
    decided_at: null,
    ...over,
  };
}

const filters = (over: Partial<Filters> = {}): Filters => ({ ...EMPTY, ...over });

describe("url round trip", () => {
  it("keeps a clean view out of the URL", () => {
    expect(toParams(EMPTY).toString()).toBe("");
    expect(countActive(EMPTY)).toBe(0);
  });

  it("survives a round trip", () => {
    const original = filters({
      q: "lagos",
      chips: ["remote", "africa"],
      companies: ["Moniepoint", "LemFi"],
      sources: ["ashby"],
      scoreMin: 10,
      scoreMax: 90,
      salary: "yes",
      posted: "week",
      signals: ["postgres"],
    });
    expect(fromParams(new URLSearchParams(toParams(original).toString()))).toEqual(original);
  });

  it("ignores junk in the URL rather than throwing", () => {
    const parsed = fromParams(new URLSearchParams("sal=maybe&posted=decade&loc=atlantis&smin=abc"));
    expect(parsed.salary).toBe("any");
    expect(parsed.posted).toBe("any");
    expect(parsed.chips).toEqual([]);
    expect(parsed.scoreMin).toBe(EMPTY.scoreMin);
  });

  it("counts active filter groups", () => {
    expect(countActive(filters({ q: "x" }))).toBe(1);
    expect(countActive(filters({ companies: ["a", "b"] }))).toBe(2);
    expect(countActive(filters({ scoreMin: 40 }))).toBe(1);
  });
});

describe("apply", () => {
  it("matches location text, title and company on the free text field", () => {
    const rows = [
      row({ locations: ["Lagos, Nigeria"] }),
      row({ title: "Staff Platform Engineer", locations: ["Berlin"] }),
      row({ company: "Lagoon Labs", locations: ["Berlin"] }),
    ];
    expect(apply(rows, filters({ q: "lagos" }), NOW)).toHaveLength(1);
    expect(apply(rows, filters({ q: "platform" }), NOW)).toHaveLength(1);
    expect(apply(rows, filters({ q: "lagoon" }), NOW)).toHaveLength(1);
  });

  it("reads chips as a union, not an intersection", () => {
    const rows = [
      row({ locations: ["Remote, US"] }),
      row({ locations: ["Lagos, Nigeria"] }),
      row({ locations: ["Tokyo"] }),
    ];
    expect(apply(rows, filters({ chips: ["remote"] }), NOW)).toHaveLength(1);
    expect(apply(rows, filters({ chips: ["remote", "africa"] }), NOW)).toHaveLength(2);
  });

  it("does not mistake Bangalore for remote", () => {
    const rows = [row({ locations: ["Remote, Bangalore"] }), row({ locations: ["Bangalore"] })];
    expect(apply(rows, filters({ chips: ["remote"] }), NOW)).toHaveLength(1);
  });

  it("filters on any source a grouped role appears under", () => {
    const rows = [row({ sources: ["ashby"] }), row({ sources: ["greenhouse", "lever"] })];
    expect(apply(rows, filters({ sources: ["lever"] }), NOW)).toHaveLength(1);
    expect(apply(rows, filters({ sources: ["ashby", "lever"] }), NOW)).toHaveLength(2);
  });

  it("treats the score range as inclusive", () => {
    const rows = [row({ score: 25 }), row({ score: 50 }), row({ score: 90 })];
    expect(apply(rows, filters({ scoreMin: 25, scoreMax: 50 }), NOW)).toHaveLength(2);
    expect(apply(rows, filters({ scoreMin: 51, scoreMax: 89 }), NOW)).toHaveLength(0);
  });

  it("splits on salary published", () => {
    const rows = [row({ salary_text: "USD 100,000" }), row({ salary_text: null })];
    expect(apply(rows, filters({ salary: "yes" }), NOW)).toHaveLength(1);
    expect(apply(rows, filters({ salary: "no" }), NOW)).toHaveLength(1);
    expect(apply(rows, filters({ salary: "any" }), NOW)).toHaveLength(2);
  });

  it("windows on posted date and drops undated rows from a window", () => {
    const rows = [
      row({ posted_at: new Date(NOW - 2 * HOUR).toISOString() }),
      row({ posted_at: new Date(NOW - 4 * 24 * HOUR).toISOString() }),
      row({ posted_at: null }),
    ];
    expect(apply(rows, filters({ posted: "24h" }), NOW)).toHaveLength(1);
    expect(apply(rows, filters({ posted: "week" }), NOW)).toHaveLength(2);
    expect(apply(rows, filters({ posted: "any" }), NOW)).toHaveLength(3);
  });

  it("requires every chosen signal, so signals narrow", () => {
    const withSignals = (names: string[]) =>
      row({ signals: names.map((name) => ({ name, weight: 10, matched: true })) });
    const rows = [withSignals(["postgres"]), withSignals(["postgres", "payments domain"])];

    expect(apply(rows, filters({ signals: ["postgres"] }), NOW)).toHaveLength(2);
    expect(apply(rows, filters({ signals: ["postgres", "payments domain"] }), NOW)).toHaveLength(1);
  });

  it("combines groups with AND", () => {
    const rows = [
      row({ company: "Moniepoint", locations: ["Lagos"], score: 80 }),
      row({ company: "Moniepoint", locations: ["Lagos"], score: 20 }),
      row({ company: "Other", locations: ["Lagos"], score: 80 }),
    ];
    expect(apply(rows, filters({ companies: ["Moniepoint"], scoreMin: 50 }), NOW)).toHaveLength(1);
  });
});

describe("facets", () => {
  const rows = [
    row({ company: "A", sources: ["ashby"], salary_text: "x", score: 80 }),
    row({ company: "A", sources: ["ashby"], salary_text: null, score: 20 }),
    row({ company: "B", sources: ["lever"], salary_text: null, score: 70 }),
  ];

  it("counts a group against the other groups, not itself", () => {
    // with company A selected, the company counts must still show B as reachable
    const result = facets(rows, filters({ companies: ["A"] }), NOW);
    expect(result.companies.find((entry) => entry.value === "B")?.count).toBe(1);
    expect(result.companies.find((entry) => entry.value === "A")?.count).toBe(2);
    // but the total respects every filter
    expect(result.total).toBe(2);
  });

  it("reflects other groups in a facet's counts", () => {
    const result = facets(rows, filters({ scoreMin: 50 }), NOW);
    expect(result.companies.find((entry) => entry.value === "A")?.count).toBe(1);
    expect(result.salary).toEqual({ yes: 1, no: 1 });
  });

  it("counts a role once per source it appears under", () => {
    const result = facets([row({ sources: ["greenhouse", "lever"] })], EMPTY, NOW);
    expect(result.sources).toEqual(
      expect.arrayContaining([
        { value: "greenhouse", count: 1 },
        { value: "lever", count: 1 },
      ]),
    );
  });

  it("gives every chip a count even at zero", () => {
    const result = facets([row({ locations: ["Tokyo"] })], EMPTY, NOW);
    expect(result.chips).toHaveLength(6);
    expect(result.chips.find((entry) => entry.value === "africa")?.count).toBe(0);
  });
});

describe("queue floor", () => {
  const rows = [row({ score: 80 }), row({ score: 25 }), row({ score: 19 }), row({ score: -40 })];

  it("hides anything under the floor by default", () => {
    expect(apply(rows, filters(), NOW)).toHaveLength(2);
  });

  it("shows the whole corpus when asked", () => {
    expect(apply(rows, filters({ showAll: true }), NOW)).toHaveLength(4);
  });

  it("counts what the floor is hiding", () => {
    expect(facets(rows, filters(), NOW).belowFloor).toBe(2);
    // with the floor lifted there is nothing left to hide
    expect(facets(rows, filters({ showAll: true }), NOW).belowFloor).toBe(2);
  });

  it("counts against the other filters, not on its own", () => {
    const mixed = [
      row({ score: 10, company: "A" }),
      row({ score: 10, company: "B" }),
      row({ score: 80, company: "A" }),
    ];
    // only A's low-scoring row is being hidden from this filtered view
    expect(facets(mixed, filters({ companies: ["A"] }), NOW).belowFloor).toBe(1);
  });

  it("does not let the floor override an explicit slider range", () => {
    // the slider still narrows within what the floor allows
    const result = apply(rows, filters({ scoreMin: 50 }), NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(80);
  });

  it("keeps showAll out of the active filter count but in the URL", () => {
    expect(countActive(filters({ showAll: true }))).toBe(0);
    expect(toParams(filters({ showAll: true })).get("all")).toBe("1");
    expect(fromParams(new URLSearchParams("all=1")).showAll).toBe(true);
  });

  it("exposes the floor as a constant so the UI can name it", () => {
    expect(QUEUE_FLOOR).toBe(20);
  });
});
