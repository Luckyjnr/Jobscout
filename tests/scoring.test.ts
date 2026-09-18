import { describe, expect, it } from "vitest";
import { scoreLocal, type LocalScore } from "../src/scoring/local.js";
import type { Job } from "../src/types.js";

function job(over: Partial<Job> = {}): Job {
  return {
    source: "test",
    sourceId: "1",
    url: "https://example.com/1",
    title: "Backend Engineer",
    company: "Acme",
    description: "",
    location: null,
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

const signal = (score: LocalScore, name: string) => score.signals.find((s) => s.name === name)!;
const matched = (score: LocalScore, name: string) => signal(score, name).matched;

describe("scoreLocal", () => {
  it("reports every signal, matched or not", () => {
    const score = scoreLocal(job({ description: "" }));
    expect(score.signals).toHaveLength(12);
    expect(score.signals.every((s) => typeof s.matched === "boolean")).toBe(true);
    expect(score.signals.filter((s) => s.matched).map((s) => s.name)).toEqual([
      "backend/full-stack title",
    ]);
  });

  it("totals only the matched weights", () => {
    const score = scoreLocal(
      job({ title: "Backend Engineer", description: "We use Node and Postgres.", salaryText: "$1" }),
    );
    // 30 title + 20 stack in description + 25 postgres + 5 salary
    expect(score.total).toBe(80);
  });

  describe("word boundaries", () => {
    it("does not read JavaScript as Java", () => {
      const score = scoreLocal(job({ description: "Strong JavaScript and TypeScript skills." }));
      expect(matched(score, "other primary stack")).toBe(false);
      expect(matched(score, "stack in description")).toBe(true);
    });

    it("does read a real Java mention", () => {
      const score = scoreLocal(job({ description: "Our backend is written in Java." }));
      expect(matched(score, "other primary stack")).toBe(true);
      expect(signal(score, "other primary stack").evidence).toBe("java");
    });

    it("does not read 'sonnet' or 'network' as .NET", () => {
      const score = scoreLocal(job({ description: "Sonnet models across our network." }));
      expect(matched(score, "other primary stack")).toBe(false);
    });

    it("does read .NET in the forms it is written", () => {
      for (const text of ["ASP.NET shop.", "Built on .NET Core.", "A dotnet team.", "We use .NET here."]) {
        expect(matched(scoreLocal(job({ description: text })), "other primary stack")).toBe(true);
      }
    });

    it("does not read a .net domain as the framework", () => {
      const score = scoreLocal(job({ description: "Apply via careers.example.net today." }));
      expect(matched(score, "other primary stack")).toBe(false);
    });

    it("no longer counts a bare API, platform or infrastructure mention", () => {
      for (const text of ["Design APIs.", "Our platform scales.", "Infrastructure work.", "Backed by capital."]) {
        expect(matched(scoreLocal(job({ description: text })), "devtools domain")).toBe(false);
      }
    });

    it("counts the multi-word devtools terms", () => {
      for (const text of ["We build developer tools.", "Our SDK ships weekly.", "An API platform.", "A developer platform."]) {
        expect(matched(scoreLocal(job({ description: text })), "devtools domain")).toBe(true);
      }
    });

    it("does not read 'nodes' as Node", () => {
      expect(matched(scoreLocal(job({ description: "Cluster nodes scale out." })), "stack in description")).toBe(false);
    });

    it("does not read 'internal' as intern", () => {
      expect(matched(scoreLocal(job({ title: "Internal Tools Engineer" })), "intern/graduate title")).toBe(false);
    });

    it("reads C# but not C++", () => {
      expect(matched(scoreLocal(job({ description: "C# and .NET Core." })), "other primary stack")).toBe(true);
      expect(matched(scoreLocal(job({ description: "Systems work in C++." })), "other primary stack")).toBe(false);
    });
  });

  describe("negatives", () => {
    it("penalises non-engineering titles", () => {
      const score = scoreLocal(job({ title: "Enterprise Account Executive" }));
      expect(matched(score, "not engineering")).toBe(true);
      expect(matched(score, "backend/full-stack title")).toBe(false);
      expect(score.total).toBe(-30);
    });

    it("penalises residency and clearance requirements", () => {
      for (const text of [
        "Must be a US citizen.",
        "Requires an active security clearance.",
        "You must have work authorization in the EU.",
        "Applicants must reside in the United States.",
      ]) {
        expect(matched(scoreLocal(job({ description: text })), "residency/clearance required")).toBe(true);
      }
    });

    it("leaves ordinary remote wording alone", () => {
      const score = scoreLocal(job({ description: "Remote within any timezone." }));
      expect(matched(score, "residency/clearance required")).toBe(false);
    });
  });

  it("carries evidence for what matched", () => {
    const score = scoreLocal(job({ description: "We run Postgres.", salaryText: "USD 100,000 per year" }));
    expect(signal(score, "postgres").evidence).toBe("postgres");
    expect(signal(score, "salary published").evidence).toBe("USD 100,000 per year");
    expect(signal(score, "payments domain").evidence).toBeUndefined();
  });
});

describe("tuning", () => {
  const filler = "x ".repeat(500); // pushes later text past the 600-char lead

  describe("payments domain needs more than a passing mention", () => {
    it("ignores one late mention", () => {
      const score = scoreLocal(job({ description: `${filler} We integrate with Stripe.` }));
      expect(matched(score, "payments domain")).toBe(false);
    });

    it("counts one mention in the lead", () => {
      const score = scoreLocal(job({ description: `We are building a payments ledger. ${filler}` }));
      expect(matched(score, "payments domain")).toBe(true);
    });

    it("counts two distinct mentions however late", () => {
      const score = scoreLocal(job({ description: `${filler} Stripe and billing work.` }));
      const signal = score.signals.find((s) => s.name === "payments domain")!;
      expect(signal.matched).toBe(true);
      expect(signal.evidence).toContain("+");
    });

    it("does not count the same term twice", () => {
      const score = scoreLocal(job({ description: `${filler} payments, payments, payments.` }));
      expect(matched(score, "payments domain")).toBe(false);
    });
  });

  describe("support", () => {
    it("penalises Customer Support", () => {
      expect(matched(scoreLocal(job({ title: "Customer Support Specialist" })), "not engineering")).toBe(true);
    });

    it("leaves Support Engineer alone", () => {
      for (const title of ["Support Engineer", "Technical Support Engineer", "Support Engineering Manager"]) {
        expect(matched(scoreLocal(job({ title })), "not engineering")).toBe(false);
      }
    });
  });

  describe("stack in the title", () => {
    it("fires on a language in the title", () => {
      for (const title of ["Senior Python Engineer", "Rust Engineer", "Node.js Developer", "Golang Engineer"]) {
        expect(matched(scoreLocal(job({ title })), "stack in title")).toBe(true);
      }
    });

    it("does not read Go-to-Market as Go", () => {
      for (const title of ["Go-to-Market Manager", "Go To Market Lead"]) {
        expect(matched(scoreLocal(job({ title })), "stack in title")).toBe(false);
      }
    });

    it("still reads a real Go role", () => {
      expect(matched(scoreLocal(job({ title: "Go Engineer" })), "stack in title")).toBe(true);
    });
  });

  it("weights the title above the description", () => {
    const titleOnly = scoreLocal(job({ title: "Backend Engineer", description: "" }));
    const descOnly = scoreLocal(job({ title: "Specialist", description: "We use Node." }));
    expect(titleOnly.total).toBeGreaterThan(descOnly.total);
  });

  it("salary is worth 5", () => {
    const signal = scoreLocal(job({ salaryText: "$1" })).signals.find((s) => s.name === "salary published")!;
    expect(signal.weight).toBe(5);
  });
});
