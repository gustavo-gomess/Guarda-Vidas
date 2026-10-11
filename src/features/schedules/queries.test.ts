import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseScheduleFilters } from "@/features/schedules/schemas";
import { toDbDate } from "@/lib/dates";
import {
  actors,
  OTHER_USER_ID,
  POST_A,
  POST_B,
} from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getScheduleForActor, listEntries, listSchedules } =
  await import("@/features/schedules/queries");
const { getAvailabilityBoard } =
  await import("@/features/availability/queries");

const filters = { from: "2099-01-10", to: "2099-01-20" };
const SCHEDULE_ID = "55555555-5555-4555-8555-555555555555";
const WINDOW_ID = "66666666-6666-4666-8666-666666666666";

let db: ReturnType<typeof fakeDb>;

function fakeDb() {
  return {
    scheduleEntry: { findMany: vi.fn().mockResolvedValue([]) },
    schedule: {
      findMany: vi.fn().mockResolvedValue([]),
      // The database would return any schedule asked for.
      findUnique: vi.fn(async () => ({
        id: SCHEDULE_ID,
        status: "PROPOSED",
        postId: POST_B,
        confirmedAt: null,
        confirmedBy: null,
        post: { id: POST_B, code: "B", name: "B", status: "OPERATING" },
        window: {
          id: WINDOW_ID,
          startDate: toDbDate("2099-01-10"),
          status: "OPEN",
        },
        entries: [],
      })),
    },
    postAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    availability: { findMany: vi.fn().mockResolvedValue([]) },
    availabilityWindow: {
      findUnique: vi.fn().mockResolvedValue({
        id: WINDOW_ID,
        startDate: toDbDate("2099-01-10"),
        status: "OPEN",
        createdBy: { name: "C" },
      }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb();
  mocks.getDb.mockReturnValue(db);
});

function entryWhere() {
  return db.scheduleEntry.findMany.mock.calls[0]![0].where;
}

describe("a lifeguard sees only their own published schedule", () => {
  it("filters by their id and published states", async () => {
    await listEntries(actors.lifeguardA, filters);
    expect(entryWhere()).toEqual({
      date: { gte: toDbDate(filters.from), lte: toDbDate(filters.to) },
      userId: actors.lifeguardA.id,
      schedule: { status: { in: ["CONFIRMED", "CHANGED"] } },
    });
  });

  it("cannot widen it with the 'profissional' filter", async () => {
    await listEntries(actors.lifeguardA, { ...filters, userId: OTHER_USER_ID });
    expect(entryWhere().userId).toBe(actors.lifeguardA.id);
  });

  it("does not get whole schedules, proposals or other people's availability", async () => {
    expect(await listSchedules(actors.lifeguardA, filters)).toEqual([]);
    expect(await getScheduleForActor(actors.captainA, SCHEDULE_ID)).toBeNull();
    expect(
      await getAvailabilityBoard(actors.lifeguardA, WINDOW_ID, {}),
    ).toBeNull();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("coordinators see their area only", () => {
  it("limits entries to their posts", async () => {
    await listEntries(actors.coordinatorA, filters);
    expect(entryWhere().schedule).toEqual({ postId: { in: [POST_A] } });
  });

  it("gets nothing when filtering by a post outside the area", async () => {
    await listEntries(actors.coordinatorA, { ...filters, postId: POST_B });
    expect(entryWhere().schedule).toEqual({ postId: { in: [] } });
  });

  it("cannot open a schedule of another post", async () => {
    expect(
      await getScheduleForActor(actors.coordinatorA, SCHEDULE_ID),
    ).toBeNull();
  });

  it("sees availability of their posts' teams only", async () => {
    await getAvailabilityBoard(actors.coordinatorA, WINDOW_ID, {});
    expect(db.user.findMany.mock.calls[0]![0].where).toMatchObject({
      role: "LIFEGUARD",
      active: true,
      assignments: { some: { postId: { in: [POST_A] } } },
    });
  });
});

describe("authority reads everything, without editing", () => {
  it("sees all entries and any schedule, read-only", async () => {
    await listEntries(actors.authority, filters);
    expect(entryWhere().schedule).toEqual({});

    const schedule = await getScheduleForActor(actors.authority, SCHEDULE_ID);
    expect(schedule).toMatchObject({ id: SCHEDULE_ID, canManage: false });
    // No candidate lists: nothing to edit.
    expect(db.postAssignment.findMany).not.toHaveBeenCalled();
    expect(schedule?.days.every((day) => day.candidates.length === 0)).toBe(
      true,
    );
  });
});

describe("filters (date, post, person)", () => {
  const today = "2099-01-10";

  it("defaults to two weeks from today", () => {
    expect(parseScheduleFilters({}, today)).toEqual({
      filters: {
        from: today,
        to: "2099-01-23",
        postId: undefined,
        userId: undefined,
      },
      errors: [],
    });
  });

  it("keeps valid values and reports invalid ones", () => {
    const { filters: parsed, errors } = parseScheduleFilters(
      { de: "2099-02-30", ate: "2099-01-12", posto: POST_A, profissional: "x" },
      today,
    );
    expect(parsed).toMatchObject({
      from: today,
      to: "2099-01-12",
      postId: POST_A,
    });
    expect(parsed.userId).toBeUndefined();
    expect(errors).toEqual([
      "Data inicial inválida.",
      "Profissional inválido no filtro.",
    ]);
  });

  it("swaps reversed dates and limits long periods", () => {
    expect(
      parseScheduleFilters({ de: "2099-01-20", ate: "2099-01-10" }, today)
        .filters,
    ).toMatchObject({ from: "2099-01-10", to: "2099-01-20" });
    const long = parseScheduleFilters(
      { de: "2099-01-01", ate: "2099-12-31" },
      today,
    );
    expect(long.filters.to).toBe("2099-03-03");
    expect(long.errors).toContain("O período foi limitado a 62 dias.");
  });
});
