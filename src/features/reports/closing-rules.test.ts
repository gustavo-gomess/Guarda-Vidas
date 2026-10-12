import { describe, expect, it } from "vitest";

import {
  availableClosingActions,
  checkClosingAction,
  nextStatus,
  reportNeeds,
  type ClosingAction,
  type ClosingStatus,
} from "@/features/reports/closing-rules";

const base = {
  canClose: true,
  status: null as ClosingStatus | null,
  expectedVersion: 0,
  currentVersion: 0,
  date: "2026-10-12",
  today: "2026-10-12",
  pendingTotal: 0,
  reason: "",
};

function check(action: ClosingAction, overrides: Partial<typeof base> = {}) {
  return checkClosingAction({ ...base, ...overrides, action });
}

describe("states", () => {
  it("defines the allowed actions per state", () => {
    expect(availableClosingActions(null)).toEqual(["SUBMIT"]);
    expect(availableClosingActions("DRAFT")).toEqual(["SUBMIT"]);
    expect(availableClosingActions("SUBMITTED")).toEqual([
      "CONSOLIDATE",
      "CORRECT",
    ]);
    expect(availableClosingActions("CONSOLIDATED")).toEqual(["CORRECT"]);
    expect(availableClosingActions("CORRECTED")).toEqual([
      "CONSOLIDATE",
      "CORRECT",
    ]);
    expect(nextStatus("SUBMIT")).toBe("SUBMITTED");
    expect(nextStatus("CONSOLIDATE")).toBe("CONSOLIDATED");
    expect(nextStatus("CORRECT")).toBe("CORRECTED");
  });

  it("tells the panels what each day still needs", () => {
    expect(reportNeeds("NOT_STARTED")).toBe("SEND");
    expect(reportNeeds("DRAFT")).toBe("SEND");
    expect(reportNeeds("SUBMITTED")).toBe("CONSOLIDATE");
    expect(reportNeeds("CORRECTED")).toBe("CONSOLIDATE");
    expect(reportNeeds("CONSOLIDATED")).toBeNull();
  });
});

describe("closing rules", () => {
  it("sends even with pending items (they stay identified)", () => {
    expect(check("SUBMIT", { pendingTotal: 4 })).toBeNull();
  });

  it("consolidates only without pending items", () => {
    expect(
      check("CONSOLIDATE", {
        status: "SUBMITTED",
        pendingTotal: 2,
        expectedVersion: 1,
        currentVersion: 1,
      }),
    ).toMatch(/2 pendência/);
    expect(
      check("CONSOLIDATE", {
        status: "SUBMITTED",
        expectedVersion: 1,
        currentVersion: 1,
      }),
    ).toBeNull();
  });

  it("requires a reason to correct", () => {
    const sent = {
      status: "CONSOLIDATED" as const,
      expectedVersion: 2,
      currentVersion: 2,
    };
    expect(check("CORRECT", sent)).toMatch(/motivo/);
    expect(
      check("CORRECT", { ...sent, reason: "Entrada sincronizada depois" }),
    ).toBeNull();
  });

  it("refuses wrong states, stale pages, future days and other users", () => {
    expect(check("CONSOLIDATE")).toMatch(/Não é possível/);
    expect(
      check("SUBMIT", {
        status: "SUBMITTED",
        expectedVersion: 1,
        currentVersion: 1,
      }),
    ).toMatch(/Não é possível/);
    // Double click: the second request still carries version 0.
    expect(check("SUBMIT", { status: "SUBMITTED", currentVersion: 1 })).toMatch(
      /mudou/,
    );
    expect(check("SUBMIT", { date: "2026-10-13" })).toMatch(/ainda não chegou/);
    expect(check("SUBMIT", { canClose: false })).toMatch(/permissão/);
  });
});
