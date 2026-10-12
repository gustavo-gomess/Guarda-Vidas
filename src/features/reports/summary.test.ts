import { describe, expect, it } from "vitest";

import {
  summarizePostDay,
  sumSummaries,
  toDaySummary,
  type RawPostDay,
} from "@/features/reports/summary";

type Journey = RawPostDay["journeys"][number];

const entry = (
  status: Journey["records"][number]["status"],
  primary = true,
) => ({
  kind: "CHECK_IN" as const,
  primary,
  status,
});
const exit = (status: Journey["records"][number]["status"] = "VALIDATED") => ({
  kind: "CHECK_OUT" as const,
  primary: true,
  status,
});

function day(overrides: Partial<RawPostDay> = {}): RawPostDay {
  return {
    postId: "p1",
    date: "2026-10-12",
    postOperating: true,
    scheduled: [],
    journeys: [],
    occurrences: [],
    alerts: [],
    changes: 0,
    ...overrides,
  };
}

const ana: Journey = {
  userId: "ana",
  name: "Ana",
  records: [entry("VALIDATED"), exit()],
  checklist: {
    status: "SUBMITTED",
    problems: [{ label: "Rádio", state: "DAMAGED" }],
  },
};
const bia: Journey = {
  userId: "bia",
  name: "Bia",
  // Offline entry awaiting validation + a preserved duplicate under review.
  records: [entry("AWAITING_VALIDATION"), entry("UNDER_REVIEW", false)],
  checklist: {
    status: "DRAFT",
    problems: [{ label: "Boia", state: "MISSING" }],
  },
};
const caio: Journey = {
  userId: "caio",
  name: "Caio",
  records: [entry("REJECTED")],
  checklist: null,
};

describe("presence", () => {
  const summary = summarizePostDay(
    day({
      scheduled: [
        { userId: "ana", name: "Ana" },
        { userId: "bia", name: "Bia" },
        { userId: "dani", name: "Dani" },
      ],
      journeys: [ana, bia, caio],
    }),
  );

  it("never counts provisional presence as validated", () => {
    expect(summary.presence).toEqual({
      validated: 1,
      provisional: 1,
      rejected: 1,
      withoutExit: 2,
      // Every record still waiting: Bia's entry and her duplicate.
      pendingRecords: 2,
    });
  });

  it("compares the schedule with who showed up", () => {
    expect(summary.staffing).toEqual({
      scheduled: 3,
      present: 3,
      absent: 1,
      unscheduled: 1,
    });
    expect(summary.warnings).toEqual(["ABSENT", "WITHOUT_EXIT", "UNSCHEDULED"]);
  });
});

describe("checklists and materials", () => {
  const summary = summarizePostDay(day({ journeys: [ana, bia, caio] }));

  it("counts sent, incomplete and not started (one per journey)", () => {
    expect(summary.checklists).toMatchObject({
      submitted: 1,
      incomplete: 1,
      notStarted: 1,
    });
  });

  it("takes material problems only from sent checklists", () => {
    expect(summary.checklists.problems).toBe(1);
    expect(summary.checklists.problemItems).toEqual([
      { label: "Rádio", state: "DAMAGED", person: "Ana" },
    ]);
  });
});

describe("occurrences and alerts", () => {
  const summary = summarizePostDay(
    day({
      occurrences: [
        { category: "Águas-vivas", annulled: false },
        { category: "Águas-vivas", annulled: false },
        { category: "Ação preventiva", annulled: false },
        { category: "Ocorrência", annulled: true },
      ],
      alerts: [
        { status: "OPEN" },
        { status: "IN_PROGRESS" },
        { status: "CLOSED" },
        { status: "CANCELLED" },
      ],
      changes: 7,
    }),
  );

  it("keeps annulled records out of the total", () => {
    expect(summary.occurrences).toEqual({
      total: 3,
      annulled: 1,
      byCategory: [
        { name: "Águas-vivas", count: 2 },
        { name: "Ação preventiva", count: 1 },
      ],
    });
  });

  it("separates active alerts", () => {
    expect(summary.alerts).toEqual({
      created: 4,
      active: 2,
      closed: 1,
      cancelled: 1,
    });
    expect(summary.changes).toBe(7);
  });
});

describe("pending items", () => {
  it("adds provisional records, unsent checklists and active alerts", () => {
    const summary = summarizePostDay(
      day({ journeys: [ana, bia, caio], alerts: [{ status: "ACKNOWLEDGED" }] }),
    );
    expect(summary.pending).toEqual({
      presence: 2,
      checklists: 2,
      alerts: 1,
      total: 5,
    });
  });

  it("is zero on a clean day; an operating post without schedule is only a warning", () => {
    const summary = summarizePostDay(day());
    expect(summary.pending.total).toBe(0);
    expect(summary.warnings).toEqual(["NO_SCHEDULE"]);
    expect(summarizePostDay(day({ postOperating: false })).warnings).toEqual(
      [],
    );
  });
});

describe("totals are sums of the same summaries", () => {
  const a = summarizePostDay(
    day({ journeys: [ana], occurrences: [{ category: "X", annulled: false }] }),
  );
  const b = summarizePostDay(
    day({
      postId: "p2",
      journeys: [bia],
      occurrences: [{ category: "X", annulled: false }],
    }),
  );

  it("adds every number and merges categories", () => {
    const total = sumSummaries([a, b]);
    expect(total.presence.validated).toBe(
      a.presence.validated + b.presence.validated,
    );
    expect(total.presence.provisional).toBe(1);
    expect(total.pending.total).toBe(a.pending.total + b.pending.total);
    expect(total.occurrences.byCategory).toEqual([{ name: "X", count: 2 }]);
    // Union of each day's warnings (no one was scheduled on either day).
    expect(total.warnings).toEqual([
      "NO_SCHEDULE",
      "UNSCHEDULED",
      "WITHOUT_EXIT",
    ]);
  });

  it("summing one summary gives the same numbers", () => {
    expect(sumSummaries([a])).toEqual(toDaySummary(a));
  });

  it("an empty period is all zeros", () => {
    expect(sumSummaries([]).pending.total).toBe(0);
  });

  it("frozen summaries carry no post or date (they belong to the closing)", () => {
    expect(toDaySummary(a)).not.toHaveProperty("postId");
    expect(toDaySummary(a)).not.toHaveProperty("date");
  });
});
