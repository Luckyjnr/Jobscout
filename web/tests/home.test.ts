import { describe, expect, it } from "vitest";
import { CRAWL_EVERY_HOURS, minutesToNextScan } from "../app/db";
import { greeting, timeOfDay } from "../app/greeting";

const at = (iso: string) => new Date(iso);

describe("minutesToNextScan", () => {
  it("counts to the next six-hourly boundary in UTC, which is the cron's clock", () => {
    // the workflow runs "0 */6 * * *": 00:00, 06:00, 12:00, 18:00 UTC
    expect(minutesToNextScan(at("2026-09-20T20:58:00Z"))).toBe(182);
    expect(minutesToNextScan(at("2026-09-20T05:30:00Z"))).toBe(30);
    expect(minutesToNextScan(at("2026-09-20T11:59:00Z"))).toBe(1);
  });

  it("gives a whole interval right after a scan fires", () => {
    expect(minutesToNextScan(at("2026-09-20T06:00:00Z"))).toBe(CRAWL_EVERY_HOURS * 60);
  });

  it("rolls over midnight rather than going negative", () => {
    expect(minutesToNextScan(at("2026-09-20T23:59:00Z"))).toBe(1);
    expect(minutesToNextScan(at("2026-09-20T18:01:00Z"))).toBe(359);
  });

  it("never exceeds the interval and never goes below zero", () => {
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const now = new Date(Date.UTC(2026, 8, 20, 0, minute));
      const n = minutesToNextScan(now);
      expect(n, now.toISOString()).toBeGreaterThanOrEqual(0);
      expect(n, now.toISOString()).toBeLessThanOrEqual(CRAWL_EVERY_HOURS * 60);
    }
  });
});

describe("greeting", () => {
  it("follows the clock", () => {
    expect(timeOfDay(at("2026-09-20T08:00:00"))).toBe("morning");
    expect(timeOfDay(at("2026-09-20T13:00:00"))).toBe("afternoon");
    expect(timeOfDay(at("2026-09-20T20:00:00"))).toBe("evening");
  });

  it("cuts at noon and six", () => {
    expect(timeOfDay(at("2026-09-20T11:59:00"))).toBe("morning");
    expect(timeOfDay(at("2026-09-20T12:00:00"))).toBe("afternoon");
    expect(timeOfDay(at("2026-09-20T17:59:00"))).toBe("afternoon");
    expect(timeOfDay(at("2026-09-20T18:00:00"))).toBe("evening");
  });

  it("uses a name when there is one", () => {
    expect(greeting("Ada", at("2026-09-20T08:00:00"))).toBe("Good morning, Ada.");
  });

  it("leaves the name out rather than inventing one", () => {
    expect(greeting(null, at("2026-09-20T08:00:00"))).toBe("Good morning.");
  });
});
