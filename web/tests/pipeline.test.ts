import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATUSES, STATUS_LABELS, STATUS_META, type Status } from "../app/pipeline";

/**
 * The pipeline vocabulary lives in two places that cannot import each other:
 * this module, and the CHECK constraint in the root schema. If they drift, the
 * board offers a state the database will refuse, and the move fails at runtime
 * with a constraint error. These tests are the seam.
 */
const schema = readFileSync(new URL("../../src/schema.sql", import.meta.url), "utf8");

function statusesInSchema(): string[] {
  const match = schema.match(/add constraint decisions_status_check\s*\n?\s*check \(status in \(([^)]*)\)\)/);
  if (!match) throw new Error("no decisions_status_check found in src/schema.sql");
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe("pipeline states", () => {
  it("are exactly the states the schema allows, in the same order", () => {
    expect(statusesInSchema()).toEqual([...STATUSES]);
  });

  it("carry a label, a colour and a description each", () => {
    for (const status of STATUSES) {
      const meta = STATUS_META[status];
      expect(meta.label, status).toMatch(/^[A-Z]/);
      expect(meta.colour, status).toMatch(/^#[0-9A-F]{6}$/);
      expect(meta.blurb, status).toMatch(/\.$/);
    }
  });

  it("use a distinct colour per state, so a column is identifiable by it alone", () => {
    const colours = STATUSES.map((s) => STATUS_META[s].colour);
    expect(new Set(colours).size).toBe(STATUSES.length);
  });

  it("keeps STATUS_LABELS in step with STATUS_META", () => {
    expect(STATUS_LABELS).toEqual(
      Object.fromEntries(STATUSES.map((s) => [s, STATUS_META[s].label])),
    );
  });

  it("drops the states this rename replaced", () => {
    const gone = ["screening", "closed"];
    for (const state of gone) {
      expect(STATUSES as readonly string[], state).not.toContain(state);
      expect(statusesInSchema(), state).not.toContain(state);
    }
  });

  it("migrates the old states rather than stranding rows on them", () => {
    expect(schema).toMatch(/update decisions set status = 'applying' where status = 'screening'/);
    expect(schema).toMatch(/update decisions set status = 'rejected' where status = 'closed'/);
    // the constraint has to come off before the rename, or the update trips it
    const drop = schema.indexOf("drop constraint if exists decisions_status_check");
    const rename = schema.indexOf("update decisions set status = 'applying'");
    const add = schema.indexOf("add constraint decisions_status_check");
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(rename);
    expect(rename).toBeLessThan(add);
  });

  it("orders the states as a pipeline: interested first, rejected last", () => {
    expect(STATUSES[0]).toBe("interested");
    expect(STATUSES[STATUSES.length - 1]).toBe("rejected");
    // applying precedes applied, or the board's arrows walk backwards
    expect(STATUSES.indexOf("applying" as Status)).toBeLessThan(STATUSES.indexOf("applied" as Status));
  });
});
