import { describe, expect, it } from "vitest";
import { isoWeek } from "../app/db";

/**
 * The W31 labels on the applications chart. ISO weeks start on Monday and a
 * week belongs to the year containing its Thursday, which is exactly the part
 * that is easy to get wrong at a year boundary.
 */
describe("isoWeek", () => {
  const week = (iso: string) => isoWeek(new Date(`${iso}T00:00:00Z`));

  it("numbers an ordinary mid-year week", () => {
    // 2026-07-27 is a Monday in ISO week 31
    expect(week("2026-07-27")).toBe(31);
    expect(week("2026-08-03")).toBe(32);
  });

  it("gives every day of one week the same number", () => {
    const days = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"];
    expect(new Set(days.map(week)).size).toBe(1);
  });

  it("starts the year on the week containing the first Thursday", () => {
    // 2026-01-01 is a Thursday, so that week is week 1
    expect(week("2026-01-01")).toBe(1);
    expect(week("2026-01-05")).toBe(2);
  });

  it("puts the last days of a year in week 1 when they belong there", () => {
    // 2024-12-30 is a Monday whose Thursday falls in 2025
    expect(week("2024-12-30")).toBe(1);
  });

  it("counts a 53-week year correctly", () => {
    // 2020 was a 53-week ISO year; 2020-12-31 is a Thursday in week 53
    expect(week("2020-12-31")).toBe(53);
  });

  it("never returns a week outside 1..53", () => {
    for (let day = 0; day < 800; day += 1) {
      const date = new Date(Date.UTC(2024, 0, 1 + day));
      const n = isoWeek(date);
      expect(n, date.toISOString()).toBeGreaterThanOrEqual(1);
      expect(n, date.toISOString()).toBeLessThanOrEqual(53);
    }
  });
});
