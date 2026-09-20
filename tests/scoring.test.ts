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
    expect(score.signals).toHaveLength(13);
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
      expect(matched(scoreLocal(job({ title: "Internal Tools Engineer" })), "junior/intern/graduate title")).toBe(false);
    });

    it("penalises junior and jr titles", () => {
      for (const title of ["Junior Backend Engineer", "Jr. Software Engineer", "Jr Developer"]) {
        expect(matched(scoreLocal(job({ title })), "junior/intern/graduate title")).toBe(true);
      }
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
      expect(score.total).toBe(-60);
    });

    it("covers the whole non-engineering title list", () => {
      const titles = [
        "Junior Accountant", "Internal Auditor", "Bookkeeper", "Finance Officer",
        "Account Officer", "Sales Manager", "Enterprise Account Executive",
        "Business Development Lead", "Technical Recruiter", "Talent Partner",
        "People Ops Lead", "HR Manager", "Marketing Executive", "Product Designer",
        "Content Strategist", "Copywriter", "Customer Success Manager",
        "Administrative Assistant", "Receptionist", "Delivery Driver",
        "Procurement Officer", "Operations Manager", "Project Manager",
        "Product Manager",
      ];
      for (const title of titles) {
        expect(matched(scoreLocal(job({ title })), "not engineering")).toBe(true);
      }
    });

    it("does not catch engineering titles that contain those words", () => {
      for (const title of ["Device Driver Engineer", "Kernel Driver Developer", "Support Engineer"]) {
        expect(matched(scoreLocal(job({ title })), "not engineering")).toBe(false);
      }
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

describe("domain signals require an engineering signal", () => {
  const paymentsText =
    "We are a payments company. You will reconcile ledgers and handle billing for our fintech clients.";

  it("does not credit a Junior Accountant for working with payments", () => {
    const score = scoreLocal(job({ title: "Junior Accountant", description: paymentsText }));
    const payments = signal(score, "payments domain");

    expect(payments.matched).toBe(false);
    // the term is still recorded, with the reason it did not count
    expect(payments.evidence).toContain("no engineering signal");
    // -60 for the accountant title, -10 for "Junior"
    expect(score.total).toBe(-70);
  });

  it("credits the same domain text in a backend role", () => {
    const score = scoreLocal(job({ title: "Backend Engineer", description: paymentsText }));
    expect(matched(score, "payments domain")).toBe(true);
  });

  it("opens the gate on a stack signal alone, with no backend title", () => {
    const byTitle = scoreLocal(job({ title: "Python Engineer", description: paymentsText }));
    expect(matched(byTitle, "payments domain")).toBe(true);

    const byDescription = scoreLocal(
      job({ title: "Software Engineer", description: `${paymentsText} We use Node and TypeScript.` }),
    );
    expect(matched(byDescription, "payments domain")).toBe(true);
  });

  it("gates devtools the same way", () => {
    const text = "We build developer tools and ship an SDK.";
    expect(matched(scoreLocal(job({ title: "Technical Writer", description: text })), "devtools domain")).toBe(false);
    expect(matched(scoreLocal(job({ title: "Backend Engineer", description: text })), "devtools domain")).toBe(true);
  });

  it("leaves the ungated signals alone", () => {
    // postgres is not gated: a database is a database whoever is hiring
    const score = scoreLocal(job({ title: "Data Analyst", description: "We run Postgres." }));
    expect(matched(score, "postgres")).toBe(true);
  });
});

describe("softening the non-engineering penalty", () => {
  const weightOf = (title: string) => signal(scoreLocal(job({ title })), "not engineering").weight;

  it("softens to -15 when the title also reads as engineering", () => {
    expect(weightOf("Software Engineer, Bill Pay & Procurement")).toBe(-15);
    expect(weightOf("Marketing Engineer")).toBe(-15);
    expect(weightOf("Systems Support / Network Engineer")).toBe(-15);
    expect(weightOf("Content Platform Developer")).toBe(-15);
  });

  it("keeps the full -60 for sales and solutions engineers", () => {
    expect(weightOf("Sales Engineer II")).toBe(-60);
    expect(weightOf("Enterprise Sales Engineer - UK")).toBe(-60);
    expect(weightOf("Technical Sales Engineer (Gas Generators)")).toBe(-60);
    expect(weightOf("Solutions Engineer, EMEA")).toBe(-60);
  });

  it("keeps the full -60 when 'engineering' is a department, not the role", () => {
    // \bengineers?\b does not match "Engineering"
    expect(weightOf("Technical Recruiter | Engineering")).toBe(-60);
    expect(weightOf("Head of Marketing, Engineering Tools")).toBe(-60);
  });

  it("leaves titles with no engineering word at the full penalty", () => {
    expect(weightOf("Junior Accountant")).toBe(-60);
    expect(weightOf("Account Executive")).toBe(-60);
  });

  it("says in the evidence why the penalty was reduced", () => {
    const score = scoreLocal(job({ title: "Marketing Engineer" }));
    expect(signal(score, "not engineering").evidence).toContain("reads as engineering");
  });

  it("still applies the softened penalty to the total", () => {
    // -15 only; no other signal fires on this title alone
    expect(scoreLocal(job({ title: "Marketing Engineer" })).total).toBe(-15);
  });
});

describe("customer-facing engineer titles", () => {
  const weightOf = (title: string) => {
    const found = scoreLocal(job({ title })).signals.find((s) => s.name === "not engineering")!;
    return found.matched ? found.weight : 0;
  };

  it("penalises solutions engineers on their own", () => {
    // nothing else in the list matches these titles
    expect(weightOf("Solutions Engineer")).toBe(-60);
    expect(weightOf("AI Solutions Engineer")).toBe(-60);
    expect(weightOf("Partner Technology Solutions Engineer")).toBe(-60);
  });

  it("keeps sales engineers at the full penalty", () => {
    expect(weightOf("Sales Engineer")).toBe(-60);
    expect(weightOf("Senior Sales Engineer - Brazil")).toBe(-60);
  });

  it("leaves ordinary engineering titles untouched", () => {
    for (const title of ["Backend Engineer", "Solutions Architect", "Platform Engineer"]) {
      expect(weightOf(title)).toBe(0);
    }
  });
});

describe("recency", () => {
  const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
  const daysAgo = (days: number) => new Date(NOW - days * 86_400_000);
  const recency = (days: number | null) =>
    scoreLocal(job({ postedAt: days === null ? null : daysAgo(days) }), NOW).signals.find(
      (s) => s.name === "recency",
    )!;

  it("rewards a posting from this week", () => {
    expect(recency(0).weight).toBe(15);
    expect(recency(7).weight).toBe(15);
  });

  it("gives a smaller nudge within a month", () => {
    expect(recency(8).weight).toBe(5);
    expect(recency(30).weight).toBe(5);
  });

  it("scores nothing in the neutral middle", () => {
    const middle = recency(90);
    expect(middle.weight).toBe(0);
    expect(middle.matched).toBe(false);
  });

  it("penalises anything over six months", () => {
    expect(recency(181).weight).toBe(-20);
    expect(recency(365).weight).toBe(-20);
  });

  it("penalises anything over a year harder", () => {
    expect(recency(366).weight).toBe(-40);
    expect(recency(3000).weight).toBe(-40);
  });

  it("treats a missing date as unknown, not old", () => {
    const none = recency(null);
    expect(none.matched).toBe(false);
    expect(none.weight).toBe(0);
  });

  it("says how old the posting is", () => {
    expect(recency(3).evidence).toContain("3d");
    expect(recency(400).evidence).toContain("over a year old");
  });

  it("counts towards the total", () => {
    const fresh = scoreLocal(job({ title: "Backend Engineer", postedAt: daysAgo(1) }), NOW);
    const old = scoreLocal(job({ title: "Backend Engineer", postedAt: daysAgo(400) }), NOW);
    expect(fresh.total - old.total).toBe(55); // +15 against -40
  });
});
