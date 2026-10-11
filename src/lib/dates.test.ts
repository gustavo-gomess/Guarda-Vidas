import { describe, expect, it } from "vitest";

import {
  addDays,
  daysBetween,
  formatIsoDate,
  fromDbDate,
  isIsoDate,
  operationalToday,
  toDbDate,
} from "@/lib/dates";

describe("operational dates", () => {
  it("uses the São Paulo calendar, not UTC", () => {
    // 01:30 UTC on the 12th is still 22:30 on the 11th in São Paulo.
    expect(operationalToday(new Date("2026-10-12T01:30:00Z"))).toBe(
      "2026-10-11",
    );
    expect(operationalToday(new Date("2026-10-12T03:00:00Z"))).toBe(
      "2026-10-12",
    );
  });

  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-10-12")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("12/10/2026")).toBe(false);
    expect(isIsoDate("2026-10-12T00:00")).toBe(false);
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-12", -2)).toBe("2026-10-10");
    expect(daysBetween("2026-10-12", "2026-10-15")).toBe(3);
    expect(daysBetween("2026-10-15", "2026-10-12")).toBe(-3);
  });

  it("round-trips database DATE values", () => {
    expect(fromDbDate(toDbDate("2026-10-12"))).toBe("2026-10-12");
  });

  it("formats for display without shifting the day", () => {
    expect(formatIsoDate("2026-10-12")).toContain("12/10/2026");
  });
});
