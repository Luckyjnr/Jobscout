import { describe, expect, it } from "vitest";
import { makeFingerprint } from "../src/types.js";

describe("makeFingerprint", () => {
  it("returns a sha256 hex digest", () => {
    expect(makeFingerprint("Acme", "Backend Engineer")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("collapses the same role listed with different decoration", () => {
    const expected = makeFingerprint("Acme Inc", "Senior Backend Engineer");

    expect(makeFingerprint("Acme", "Backend Engineer (Senior)")).toBe(expected);
    expect(makeFingerprint("ACME, Inc.", "Backend Engineer - Remote")).toBe(expected);
  });

  it("keeps genuinely different roles apart", () => {
    expect(makeFingerprint("Acme", "Backend Engineer")).not.toBe(
      makeFingerprint("Acme", "Frontend Engineer"),
    );
  });
});
