import { describe, expect, it } from "vitest";
import { scoreLocal } from "../src/scoring/local.js";
import {
  BAND_LABELS,
  analysisSource,
  matchBand,
  matchGaps,
  matchPercent,
  matchReasons,
  matchScore,
  matchSummary,
  skillChips,
  skillsMatchedCount,
  type Presentable,
} from "../src/scoring/present.js";
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
    remote: false,
    salaryText: null,
    postedAt: null,
    fetchedAt: new Date(),
    fingerprint: "",
    postingFingerprint: "",
    raw: null,
    ...over,
  };
}

/** Score a job for real, then present it — the two halves have to agree. */
function present(over: Partial<Job> = {}, extra: Partial<Presentable> = {}): Presentable {
  const source = job(over);
  const scored = scoreLocal(source);
  return { score: scored.total, signals: scored.signals, remote: source.remote, ...extra };
}

describe("matchPercent", () => {
  it("clamps outside the corpus range", () => {
    expect(matchPercent(-200)).toBe(0);
    expect(matchPercent(-60)).toBe(0);
    expect(matchPercent(130)).toBe(100);
    expect(matchPercent(400)).toBe(100);
  });

  it("reads 90+ raw as 90%+, which is the point of the curve", () => {
    expect(matchPercent(90)).toBeGreaterThanOrEqual(90);
    expect(matchPercent(100)).toBeGreaterThanOrEqual(90);
    expect(matchPercent(129)).toBeGreaterThanOrEqual(90);
  });

  it("beats a straight linear map at the top, which would put 90 at 79%", () => {
    const linear = Math.round(((90 - -60) / (130 - -60)) * 100);
    expect(linear).toBe(79);
    expect(matchPercent(90)).toBeGreaterThan(linear);
  });

  it("never goes backwards as the score rises", () => {
    let previous = -1;
    for (let raw = -80; raw <= 150; raw += 1) {
      const pct = matchPercent(raw);
      expect(pct, `raw ${raw}`).toBeGreaterThanOrEqual(previous);
      previous = pct;
    }
  });

  it("stays inside 0-100 across the whole range", () => {
    for (let raw = -200; raw <= 200; raw += 1) {
      expect(matchPercent(raw)).toBeGreaterThanOrEqual(0);
      expect(matchPercent(raw)).toBeLessThanOrEqual(100);
    }
  });

  it("treats a missing score as zero rather than throwing", () => {
    expect(matchPercent(null)).toBe(0);
    expect(matchPercent(undefined)).toBe(0);
    expect(matchPercent(Number.NaN)).toBe(0);
  });
});

describe("matchBand", () => {
  it("cuts at the stated thresholds", () => {
    expect(matchBand(100)).toBe("strong");
    expect(matchBand(85)).toBe("strong");
    expect(matchBand(84)).toBe("good");
    expect(matchBand(70)).toBe("good");
    expect(matchBand(69)).toBe("fair");
    expect(matchBand(50)).toBe("fair");
    expect(matchBand(49)).toBe("weak");
    expect(matchBand(0)).toBe("weak");
  });

  it("has a label for every band", () => {
    for (const band of ["strong", "good", "fair", "weak"] as const) {
      expect(BAND_LABELS[band]).toMatch(/match$/);
    }
  });
});

describe("skillChips", () => {
  it("names the stack the way a person writes it", () => {
    const chips = skillChips(
      present({
        title: "Senior Backend Engineer",
        description: "We use Node.js, TypeScript and Postgres to build things.",
      }),
    );
    expect(chips).toContain("Node.js");
    expect(chips).toContain("PostgreSQL");
    expect(chips).toContain("Backend");
  });

  it("strips the scorer's annotations out of the evidence", () => {
    // "stripe (in lead)" must not become a chip reading "Stripe (in lead)"
    const chips = skillChips(
      present({
        title: "Backend Engineer",
        description: "Stripe integrations on our payments team. We run Node and Postgres.",
      }),
    );
    for (const chip of chips) {
      expect(chip).not.toMatch(/[()]/);
      expect(chip).not.toContain("—");
    }
  });

  it("splits a multi-term evidence string into separate chips", () => {
    const chips = skillChips(
      present({
        title: "Backend Engineer",
        description:
          "Node and TypeScript. Our payments platform handles ledgers and fintech billing flows.",
      }),
    );
    expect(chips).not.toContain("Payments + Fintech + Ledgers");
    expect(chips.some((c) => c === "Payments" || c === "Fintech" || c === "Ledgers")).toBe(true);
  });

  it("adds Remote from the posting's own flag, not from a rule", () => {
    const chips = skillChips(present({ title: "Backend Engineer", remote: true }));
    expect(chips).toContain("Remote");
    expect(skillChips(present({ title: "Backend Engineer", remote: false }))).not.toContain("Remote");
  });

  it("never exceeds six", () => {
    const chips = skillChips(
      present({
        title: "Senior Backend Engineer, Node",
        description:
          "Node.js, TypeScript, NestJS, Postgres. Payments, fintech, ledgers, escrow, stripe, billing. " +
          "We ship SDKs and a developer platform. We hire globally.",
        remote: true,
      }),
    );
    expect(chips.length).toBeLessThanOrEqual(6);
  });

  it("deduplicates a skill named in both title and description", () => {
    const chips = skillChips(
      present({ title: "Node Engineer", description: "You will write Node every day." }),
    );
    expect(chips.filter((c) => c === "Node.js")).toHaveLength(1);
  });

  it("draws nothing from a posting that evidences nothing", () => {
    expect(skillChips(present({ title: "Office Administrator", description: "" }))).toEqual([]);
  });

  it("does not turn salary or age into a skill", () => {
    const chips = skillChips(
      present({ title: "Backend Engineer", salaryText: "$120k", postedAt: new Date() }),
    );
    expect(chips).not.toContain("$120K");
    for (const chip of chips) expect(chip).not.toMatch(/\$|\bwithin\b/i);
  });
});

describe("skillsMatchedCount", () => {
  it("counts against a fixed total, so the denominator does not move", () => {
    const bare = skillsMatchedCount(present({ title: "Office Administrator" }));
    const rich = skillsMatchedCount(
      present({ title: "Backend Engineer", description: "Node, TypeScript, Postgres." }),
    );
    expect(bare.total).toBe(rich.total);
    expect(rich.matched).toBeGreaterThan(bare.matched);
  });

  it("survives a signal list filtered down to the matched ones, as the DB stores it", () => {
    const full = present({ title: "Backend Engineer", description: "Node and Postgres." });
    const filtered: Presentable = { ...full, signals: full.signals.filter((s) => s.matched) };
    expect(skillsMatchedCount(filtered)).toEqual(skillsMatchedCount(full));
  });

  it("never reports more matched than total", () => {
    const rich = skillsMatchedCount(
      present({
        title: "Senior Backend Engineer, Node",
        description: "Node, TypeScript, Postgres, payments, fintech, SDKs, developer tools, globally.",
      }),
    );
    expect(rich.matched).toBeLessThanOrEqual(rich.total);
  });
});

describe("matchReasons", () => {
  it("writes a signal as a reason, not as a rule name", () => {
    const reasons = matchReasons(
      present({ title: "Backend Engineer", description: "We run Postgres and Node.js." }),
    );
    expect(reasons).toContain("Runs on PostgreSQL.");
    expect(reasons).toContain("Node.js is named in the description.");
    for (const line of reasons) {
      expect(line).toMatch(/\.$/);
      expect(line).not.toContain("stack in description");
    }
  });

  it("says a job hires globally when it says so", () => {
    const reasons = matchReasons(
      present({ title: "Backend Engineer", description: "We hire globally." }),
    );
    expect(reasons).toContain("Hires globally.");
  });

  it("carries no negative signal into the reasons", () => {
    const reasons = matchReasons(
      present({ title: "Junior Backend Engineer", description: "A Ruby shop." }),
    );
    for (const line of reasons) {
      expect(line).not.toMatch(/ruby|junior/i);
    }
  });

  it("prefers the LLM's reasons where it has run", () => {
    const withLlm = present(
      { title: "Backend Engineer", description: "Node and Postgres." },
      { fit: 88, reasons: ["Their platform team is the one you want."] },
    );
    expect(matchReasons(withLlm)).toEqual(["Their platform team is the one you want."]);
  });
});

describe("matchGaps", () => {
  it("names the wrong stack", () => {
    const gaps = matchGaps(present({ title: "Backend Engineer", description: "A Ruby codebase." }));
    expect(gaps).toContain("Primary stack is Ruby, not yours.");
  });

  it("calls out an old posting", () => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    expect(matchGaps(present({ title: "Backend Engineer", postedAt: old }))).toContain(
      "Posted over a year ago.",
    );
  });

  it("distinguishes a softened title penalty from a full one", () => {
    const full = matchGaps(present({ title: "Marketing Manager" }));
    const softened = matchGaps(present({ title: "Marketing Engineer" }));
    expect(full.join(" ")).toMatch(/rather than engineering/);
    expect(softened.join(" ")).toMatch(/though it reads as engineering/);
  });

  it("carries no positive signal into the gaps", () => {
    const gaps = matchGaps(
      present({ title: "Backend Engineer", description: "Node, Postgres, Ruby." }),
    );
    for (const line of gaps) expect(line).not.toMatch(/postgresql|node\.js/i);
  });

  it("prefers the LLM's concerns where it has run", () => {
    const withLlm = present(
      { title: "Backend Engineer", description: "A Ruby codebase." },
      { fit: 40, concerns: ["The team is three people and you would be on call."] },
    );
    expect(matchGaps(withLlm)).toEqual(["The team is three people and you would be on call."]);
  });

  it("is empty for a posting with nothing against it", () => {
    expect(matchGaps(present({ title: "Backend Engineer", description: "Node and Postgres." }))).toEqual([]);
  });
});

describe("matchSummary", () => {
  it("is two sentences", () => {
    const summary = matchSummary(
      present({ title: "Backend Engineer", description: "Node, TypeScript and Postgres." }),
    );
    expect(summary.match(/\.\s|\.$/g)?.length).toBe(2);
  });

  it("names the band, the percentage and what carries it", () => {
    const p = present({ title: "Backend Engineer", description: "Node.js and Postgres." });
    const summary = matchSummary(p);
    expect(summary).toContain(`${matchScore(p)}%`);
    expect(summary).toContain(BAND_LABELS[matchBand(matchScore(p))]);
    expect(summary).toMatch(/PostgreSQL|Node\.js|Backend/);
  });

  it("says plainly when nothing counts against a job", () => {
    const summary = matchSummary(
      present({ title: "Backend Engineer", description: "Node and Postgres." }),
    );
    expect(summary).toContain("Nothing in the posting counts against it.");
  });

  it("raises the strongest gap when there is one", () => {
    const summary = matchSummary(
      present({ title: "Backend Engineer", description: "A Ruby codebase throughout." }),
    );
    expect(summary).toMatch(/ruby/i);
  });

  it("does not leave a double capital mid-sentence when folding a gap in", () => {
    const summary = matchSummary(
      present({ title: "Backend Engineer", description: "A Ruby codebase." }),
    );
    expect(summary).not.toMatch(/: [A-Z][a-z]/);
  });

  it("holds up for a job with no signals at all", () => {
    const summary = matchSummary({ score: 0, signals: [] });
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("%");
  });
});

describe("the LLM takes precedence", () => {
  it("reports which analysis is on show", () => {
    expect(analysisSource(present({ title: "Backend Engineer" }))).toBe("derived");
    expect(analysisSource(present({ title: "Backend Engineer" }, { fit: 70 }))).toBe("llm");
  });

  it("uses fit as the headline percentage, not the curve", () => {
    const p = present({ title: "Backend Engineer", description: "Node and Postgres." }, { fit: 42 });
    expect(matchScore(p)).toBe(42);
    expect(matchScore({ ...p, fit: null })).toBe(matchPercent(p.score));
  });

  it("clamps a fit outside 0-100", () => {
    expect(matchScore(present({}, { fit: 140 }))).toBe(100);
    expect(matchScore(present({}, { fit: -10 }))).toBe(0);
  });

  it("falls back to derived text when the LLM returned empty lists", () => {
    const p = present(
      { title: "Backend Engineer", description: "Node and Postgres." },
      { fit: 80, reasons: [], concerns: [] },
    );
    expect(matchReasons(p).length).toBeGreaterThan(0);
  });
});
