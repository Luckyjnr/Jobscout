import { describe as group, expect, it } from "vitest";
import { describe, sectionsFound, type Block } from "../app/description";

const headings = (blocks: Block[]) =>
  blocks.filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading");
const lists = (blocks: Block[]) =>
  blocks.filter((b): b is Extract<Block, { kind: "list" }> => b.kind === "list");

group("describe", () => {
  it("returns nothing for an empty description", () => {
    expect(describe("")).toEqual([]);
    expect(describe("   \n\n  ")).toEqual([]);
  });

  it("leaves a description with no headings as plain paragraphs", () => {
    const blocks = describe("We are hiring an engineer.\n\nYou would join a small team.");
    expect(blocks).toEqual([
      { kind: "paragraph", text: "We are hiring an engineer." },
      { kind: "paragraph", text: "You would join a small team." },
    ]);
    expect(sectionsFound(blocks)).toEqual([]);
  });

  it("finds the five sections the design names", () => {
    const blocks = describe(
      [
        "About the Role",
        "We need someone to own the API.",
        "Responsibilities",
        "- Ship features",
        "Requirements",
        "- Five years of experience",
        "Nice to Have",
        "- Kubernetes",
        "Benefits",
        "- Health cover",
      ].join("\n\n"),
    );
    expect(sectionsFound(blocks)).toEqual([
      "about",
      "responsibilities",
      "requirements",
      "nice-to-have",
      "benefits",
    ]);
  });

  it("shows the posting's own wording, not a canonical rewrite", () => {
    const blocks = describe("What you'll do\n\n- Build things");
    const [heading] = headings(blocks);
    expect(heading!.text).toBe("What you'll do");
    expect(heading!.section).toBe("responsibilities");
  });

  it("matches the heading variants boards actually use", () => {
    const cases: Array<[string, string]> = [
      ["Who we are", "about"],
      ["The Opportunity", "about"],
      ["Key Responsibilities", "responsibilities"],
      ["What you will be doing", "responsibilities"],
      ["Qualifications", "requirements"],
      ["What we're looking for", "requirements"],
      ["Nice-to-have", "nice-to-have"],
      ["Bonus points", "nice-to-have"],
      ["Preferred Qualifications", "nice-to-have"],
      ["What we offer", "benefits"],
      ["Perks and Benefits", "benefits"],
    ];
    for (const [text, section] of cases) {
      const blocks = describe(`${text}\n\nSomething follows.`);
      expect(headings(blocks)[0]?.section, text).toBe(section);
    }
  });

  it("puts 'Preferred qualifications' under nice-to-have, not requirements", () => {
    // the requirements patterns would otherwise swallow it
    const blocks = describe("Preferred qualifications\n\n- Rust");
    expect(headings(blocks)[0]!.section).toBe("nice-to-have");
  });

  it("strips a trailing colon from a heading", () => {
    const blocks = describe("Requirements:\n\n- A pulse");
    expect(headings(blocks)[0]!.text).toBe("Requirements");
  });

  it("does not mistake a sentence for a heading", () => {
    const blocks = describe("The requirements below are flexible for the right person.");
    expect(headings(blocks)).toHaveLength(0);
  });

  it("does not treat a long line as a heading", () => {
    const long = `Requirements ${"and more ".repeat(12)}`.trim();
    expect(headings(describe(long))).toHaveLength(0);
  });

  it("does not treat a heading-shaped line ending in a full stop as a heading", () => {
    expect(headings(describe("Responsibilities."))).toHaveLength(0);
  });

  it("gathers bullets into one list", () => {
    const blocks = describe("- One\n- Two\n- Three");
    expect(lists(blocks)).toHaveLength(1);
    expect(lists(blocks)[0]!.items).toEqual(["One", "Two", "Three"]);
  });

  it("merges bullets a board separated with blank lines", () => {
    // this is exactly what Greenhouse descriptions look like after stripping
    const blocks = describe("Responsibilities\n\n- One\n\n- Two\n\n- Three");
    expect(lists(blocks)).toHaveLength(1);
    expect(lists(blocks)[0]!.items).toEqual(["One", "Two", "Three"]);
  });

  it("handles the bullet characters boards actually use", () => {
    const blocks = describe("• One\n* Two\n– Three\n1. Four\n2) Five");
    expect(lists(blocks)[0]!.items).toEqual(["One", "Two", "Three", "Four", "Five"]);
  });

  it("splits a chunk that leads with prose and then bullets", () => {
    const blocks = describe("You will be responsible for the following things:\n- One\n- Two");
    expect(blocks[0]!.kind).toBe("paragraph");
    expect(lists(blocks)[0]!.items).toEqual(["One", "Two"]);
  });

  it("keeps a heading that leads its own bullets attached to the right section", () => {
    const blocks = describe("Requirements:\n- Five years\n- A pulse");
    expect(headings(blocks)[0]!.section).toBe("requirements");
    expect(lists(blocks)[0]!.items).toEqual(["Five years", "A pulse"]);
  });

  it("does not start a list with an empty item", () => {
    const blocks = describe("- \n- Real item");
    expect(lists(blocks)[0]!.items).toEqual(["Real item"]);
  });

  it("normalises Windows line endings", () => {
    const blocks = describe("Requirements\r\n\r\n- One\r\n- Two");
    expect(headings(blocks)).toHaveLength(1);
    expect(lists(blocks)[0]!.items).toEqual(["One", "Two"]);
  });

  it("keeps every word of the description somewhere", () => {
    const source = "About the Role\n\nWe build things.\n\nRequirements\n\n- Node\n- Postgres";
    const blocks = describe(source);
    const rendered = blocks
      .map((b) => (b.kind === "list" ? b.items.join(" ") : b.text))
      .join(" ");
    for (const word of ["We", "build", "things", "Node", "Postgres"]) {
      expect(rendered).toContain(word);
    }
  });

  it("invents no section for a description that has none", () => {
    const blocks = describe("A long paragraph about the company and nothing else at all.");
    expect(sectionsFound(blocks)).toEqual([]);
    expect(headings(blocks)).toHaveLength(0);
  });
});

group("company headings", () => {
  it("reads 'About Stripe' as the about section", () => {
    const blocks = describe("About Stripe\n\nWe build payments infrastructure.");
    expect(headings(blocks)[0]?.section).toBe("about");
  });

  it("reads 'About You' as requirements, because that is the candidate", () => {
    const blocks = describe("About You\n\n- Five years of experience");
    expect(headings(blocks)[0]?.section).toBe("requirements");
  });

  it("does not treat an arbitrary 'About <lowercase>' phrase as a heading", () => {
    expect(headings(describe("About twenty engineers work here"))).toHaveLength(0);
  });
});
