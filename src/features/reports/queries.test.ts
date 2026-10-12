import { beforeEach, describe, expect, it, vi } from "vitest";

import { summarizePostDay } from "@/features/reports/summary";
import { actors, POST_A, POST_B } from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), loadSummaries: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/features/reports/load", () => ({
  loadSummaries: mocks.loadSummaries,
}));

const { getClosingForActor, getOverview, listTeams } =
  await import("@/features/reports/queries");

const TODAY = "2026-10-12";
const filters = { from: "2026-10-11", to: TODAY };
const post = { id: POST_A, code: "A", name: "A", status: "OPERATING" };

function raw(date: string) {
  return {
    postId: POST_A,
    date,
    postOperating: true,
    scheduled: [],
    journeys: [],
    occurrences: [],
    alerts: [],
    changes: 0,
  };
}

let db: {
  dailyClosing: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  post: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  db = {
    dailyClosing: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    post: { findMany: vi.fn().mockResolvedValue([]) },
  };
  mocks.getDb.mockReturnValue(db);
  mocks.loadSummaries.mockResolvedValue({
    posts: [post],
    summaries: [
      summarizePostDay(raw("2026-10-11")),
      summarizePostDay(raw(TODAY)),
    ],
  });
});

const scopeArg = () => mocks.loadSummaries.mock.calls[0]![1];

describe("who sees which posts", () => {
  it("lifeguards have no indicators panel", async () => {
    expect(await getOverview(actors.lifeguardA, filters, TODAY)).toBeNull();
    expect(await getOverview(actors.captainA, filters, TODAY)).toBeNull();
    expect(await listTeams(actors.lifeguardA)).toBeNull();
    expect(mocks.loadSummaries).not.toHaveBeenCalled();
  });

  it("a coordinator sees the area; another post's filter gives nothing", async () => {
    await getOverview(actors.coordinatorA, filters, TODAY);
    expect(scopeArg()).toEqual({ postIds: [POST_A] });
    vi.clearAllMocks();
    mocks.loadSummaries.mockResolvedValue({ posts: [], summaries: [] });
    await getOverview(
      actors.coordinatorA,
      { ...filters, postId: POST_B },
      TODAY,
    );
    expect(scopeArg()).toEqual({ postIds: [] });
  });

  it("authority sees every post", async () => {
    await getOverview(actors.authority, filters, TODAY);
    expect(scopeArg()).toEqual({});
  });

  it("a closing outside the area is not found", async () => {
    expect(
      await getClosingForActor(actors.coordinatorA, POST_B, TODAY, TODAY),
    ).toBeNull();
    expect(
      await getClosingForActor(actors.lifeguardA, POST_A, TODAY, TODAY),
    ).toBeNull();
  });
});

describe("aggregation for the panels", () => {
  it("marks days that still need sending or consolidation, never future ones", async () => {
    db.dailyClosing.findMany.mockResolvedValue([
      {
        postId: POST_A,
        date: new Date("2026-10-11T00:00:00Z"),
        status: "SUBMITTED",
      },
    ]);
    const overview = await getOverview(
      actors.coordinatorA,
      filters,
      "2026-10-11",
    );
    expect(
      overview?.rows.map((row) => [row.date, row.report, row.needs]),
    ).toEqual([
      ["2026-10-11", "SUBMITTED", "CONSOLIDATE"],
      [TODAY, "NOT_STARTED", null],
    ]);
    expect(overview?.reportsToConsolidate).toBe(1);
    expect(overview?.reportsToSend).toBe(0);
  });

  it("totals are the sum of the rows", async () => {
    const overview = await getOverview(actors.authority, filters, TODAY);
    expect(overview?.total.warnings).toEqual(["NO_SCHEDULE"]);
    expect(overview?.byPost[0]?.rows).toHaveLength(2);
  });
});

describe("closing page", () => {
  it("authority reads without actions", async () => {
    mocks.loadSummaries.mockResolvedValue({
      posts: [post],
      summaries: [summarizePostDay(raw(TODAY))],
    });
    expect(
      await getClosingForActor(actors.authority, POST_A, TODAY, TODAY),
    ).toMatchObject({
      canClose: false,
      actions: [],
      report: "NOT_STARTED",
    });
  });

  it("the post's coordinator can send, but not a future day", async () => {
    mocks.loadSummaries.mockResolvedValue({
      posts: [post],
      summaries: [summarizePostDay(raw(TODAY))],
    });
    expect(
      await getClosingForActor(actors.coordinatorA, POST_A, TODAY, TODAY),
    ).toMatchObject({
      canClose: true,
      actions: ["SUBMIT"],
    });
    expect(
      await getClosingForActor(
        actors.coordinatorA,
        POST_A,
        TODAY,
        "2026-10-11",
      ),
    ).toMatchObject({ canClose: false, actions: [] });
  });
});
