import { beforeEach, describe, expect, it, vi } from "vitest";

import { summarizePostDay, toDaySummary } from "@/features/reports/summary";
import { operationalToday } from "@/lib/dates";
import { actors, form, POST_A, POST_B } from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  getDb: vi.fn(),
  loadSummaries: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/reports/load", () => ({
  loadSummaries: mocks.loadSummaries,
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() },
}));

const { closingAction, saveClosingNotesAction } =
  await import("@/features/reports/actions");

const TODAY = operationalToday(new Date());
const FORBIDDEN = {
  ok: false,
  error: "Você não tem permissão para esta operação.",
};

function summary(pendingAlerts = 0) {
  return summarizePostDay({
    postId: POST_A,
    date: TODAY,
    postOperating: true,
    scheduled: [],
    journeys: [],
    occurrences: [],
    alerts: Array.from({ length: pendingAlerts }, () => ({
      status: "OPEN" as const,
    })),
    changes: 0,
  });
}

function fakeDb(
  closing: null | {
    id: string;
    status: string;
    notes: string;
    currentVersion: number;
  },
) {
  const tx = {
    $executeRaw: vi.fn(),
    dailyClosing: {
      findUnique: vi.fn().mockResolvedValue(closing),
      create: vi.fn().mockResolvedValue({
        id: "c1",
        status: "DRAFT",
        notes: "",
        currentVersion: 0,
      }),
      update: vi.fn(),
    },
    dailyClosingVersion: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
}

let db: ReturnType<typeof fakeDb>["db"];
let tx: ReturnType<typeof fakeDb>["tx"];
function useDb(closing: Parameters<typeof fakeDb>[0] = null) {
  ({ db, tx } = fakeDb(closing));
  mocks.getDb.mockReturnValue(db);
}

const act = (action: string, extra: Record<string, string> = {}) =>
  closingAction(
    null,
    form({
      postId: POST_A,
      date: TODAY,
      action,
      expectedVersion: "0",
      reason: "",
      ...extra,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
  mocks.loadSummaries.mockResolvedValue({ posts: [], summaries: [summary()] });
});

describe("permissions", () => {
  it.each([
    ["authority", actors.authority],
    ["administrator outside the area", actors.admin],
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
  ])("the %s cannot close", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await act("SUBMIT")).toEqual(FORBIDDEN);
    expect(
      await saveClosingNotesAction(
        null,
        form({ postId: POST_A, date: TODAY, notes: "x" }),
      ),
    ).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a coordinator cannot close another post", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    expect(
      await closingAction(
        null,
        form({
          postId: POST_B,
          date: TODAY,
          action: "SUBMIT",
          expectedVersion: "0",
          reason: "",
        }),
      ),
    ).toEqual(FORBIDDEN);
  });
});

describe("closing (post's coordinator)", () => {
  beforeEach(() => mocks.requireActor.mockResolvedValue(actors.coordinatorA));

  it("sends with pending items, freezing what it read", async () => {
    mocks.loadSummaries.mockResolvedValue({
      posts: [],
      summaries: [summary(2)],
    });
    expect(await act("SUBMIT")).toEqual({ ok: true, data: undefined });
    expect(tx.$executeRaw).toHaveBeenCalled(); // closing row locked
    // The summary was read inside the same transaction.
    expect(mocks.loadSummaries.mock.calls[0]![0]).toBe(tx);
    expect(tx.dailyClosingVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 1,
        kind: "SUBMISSION",
        pendingCount: 2,
        summary: toDaySummary(summary(2)),
        authorId: actors.coordinatorA.id,
      }),
    });
    expect(tx.dailyClosing.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "SUBMITTED", currentVersion: 1 },
    });
  });

  it("does not consolidate with pending items", async () => {
    useDb({ id: "c1", status: "SUBMITTED", notes: "", currentVersion: 1 });
    mocks.loadSummaries.mockResolvedValue({
      posts: [],
      summaries: [summary(1)],
    });
    expect(await act("CONSOLIDATE", { expectedVersion: "1" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/pendência/),
    });
    expect(tx.dailyClosingVersion.create).not.toHaveBeenCalled();
  });

  it("consolidates a clean day as a new version", async () => {
    useDb({
      id: "c1",
      status: "SUBMITTED",
      notes: "Mar calmo",
      currentVersion: 1,
    });
    expect((await act("CONSOLIDATE", { expectedVersion: "1" })).ok).toBe(true);
    expect(tx.dailyClosingVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 2,
        kind: "CONSOLIDATION",
        notes: "Mar calmo",
      }),
    });
  });

  it("corrects only with a reason, never overwriting earlier versions", async () => {
    useDb({ id: "c1", status: "CONSOLIDATED", notes: "", currentVersion: 2 });
    expect((await act("CORRECT", { expectedVersion: "2" })).ok).toBe(false);
    expect(
      (
        await act("CORRECT", {
          expectedVersion: "2",
          reason: "Entrada sincronizada depois",
        })
      ).ok,
    ).toBe(true);
    expect(tx.dailyClosingVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 3,
        kind: "CORRECTION",
        reason: "Entrada sincronizada depois",
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "closing.correct",
        reason: "Entrada sincronizada depois",
      }),
    });
  });

  it("refuses a repeated submission from a stale page", async () => {
    useDb({ id: "c1", status: "SUBMITTED", notes: "", currentVersion: 1 });
    expect(await act("SUBMIT")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/mudou/),
    });
  });
});
