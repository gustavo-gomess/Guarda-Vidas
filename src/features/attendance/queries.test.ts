import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDbDate } from "@/lib/dates";
import { actors, POST_A, POST_B } from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const {
  getJourneyForActor,
  getMyPresence,
  getPresenceBoard,
  listValidationQueue,
} = await import("@/features/attendance/queries");

const JOURNEY_ID = "13131313-1313-4131-8131-131313131313";

function fakeDb(owner: string, postId: string) {
  return {
    attendanceRecord: { findMany: vi.fn().mockResolvedValue([]) },
    journey: {
      findMany: vi.fn().mockResolvedValue([]),
      // The database would return any journey asked for.
      findUnique: vi.fn().mockResolvedValue({
        id: JOURNEY_ID,
        date: toDbDate("2026-10-12"),
        userId: owner,
        postId,
        createdAt: new Date(),
        user: { name: "X" },
        post: { code: "A", name: "A" },
        records: [],
      }),
    },
    scheduleEntry: { findMany: vi.fn().mockResolvedValue([]) },
    post: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

let db: ReturnType<typeof fakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb(actors.lifeguardA.id, POST_A);
  mocks.getDb.mockReturnValue(db);
});

describe("journeys (consult and audit)", () => {
  it("the lifeguard opens their own journey", async () => {
    expect(
      await getJourneyForActor(actors.lifeguardA, JOURNEY_ID),
    ).toMatchObject({
      id: JOURNEY_ID,
      canDecide: false,
    });
  });

  it("another lifeguard of the same post cannot (horizontal access)", async () => {
    expect(await getJourneyForActor(actors.captainA, JOURNEY_ID)).toBeNull();
  });

  it("the post's coordinator opens it and may decide; authority only reads", async () => {
    expect(
      await getJourneyForActor(actors.coordinatorA, JOURNEY_ID),
    ).toMatchObject({ canDecide: true });
    expect(
      await getJourneyForActor(actors.authority, JOURNEY_ID),
    ).toMatchObject({ canDecide: false });
  });

  it("a coordinator of another area cannot", async () => {
    db = fakeDb(actors.lifeguardA.id, POST_B);
    mocks.getDb.mockReturnValue(db);
    expect(
      await getJourneyForActor(actors.coordinatorA, JOURNEY_ID),
    ).toBeNull();
  });
});

describe("queue and board", () => {
  it("are not available to lifeguards", async () => {
    expect(await listValidationQueue(actors.lifeguardA, {})).toBeNull();
    expect(
      await getPresenceBoard(actors.captainA, { date: "2026-10-12" }),
    ).toBeNull();
    expect(db.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it("are limited to the coordinator's area", async () => {
    await listValidationQueue(actors.coordinatorA, {});
    expect(db.attendanceRecord.findMany.mock.calls[0]![0].where).toMatchObject({
      status: { in: ["AWAITING_VALIDATION", "UNDER_REVIEW"] },
      postId: { in: [POST_A] },
    });
    await listValidationQueue(actors.coordinatorA, { postId: POST_B });
    expect(db.attendanceRecord.findMany.mock.calls[1]![0].where.postId).toEqual(
      {
        in: [],
      },
    );
  });

  it("the board separates validated and provisional presence", async () => {
    db.journey.findMany.mockResolvedValue([
      {
        id: "j1",
        user: { id: "u1", name: "Ana" },
        post: { id: POST_A, code: "A", name: "A" },
        records: [
          {
            id: "r1",
            kind: "CHECK_IN",
            origin: "OFFLINE",
            status: "AWAITING_VALIDATION",
            deviceTime: new Date("2026-10-12T10:00:00Z"),
            receivedAt: new Date("2026-10-12T13:00:00Z"),
            flags: [],
          },
        ],
        _count: { records: 2 },
      },
    ]);
    db.scheduleEntry.findMany.mockResolvedValue([
      {
        user: { id: "u2", name: "Bia" },
        schedule: { post: { id: POST_A, code: "A", name: "A" } },
      },
    ]);
    const rows = await getPresenceBoard(actors.authority, {
      date: "2026-10-12",
    });
    expect(rows).toEqual([
      expect.objectContaining({
        user: { id: "u1", name: "Ana" },
        scheduledPost: null,
        journey: expect.objectContaining({
          extraRecords: 1,
          checkIn: expect.objectContaining({
            status: "AWAITING_VALIDATION",
            // Offline: the declared device time, not the receipt time.
            time: "2026-10-12T10:00:00.000Z",
          }),
        }),
      }),
      expect.objectContaining({
        user: { id: "u2", name: "Bia" },
        journey: null,
      }),
    ]);
  });
});

describe("the presence screen", () => {
  it("is only for lifeguards and only their own data", async () => {
    expect(await getMyPresence(actors.coordinatorA, "2026-10-12")).toBeNull();
    await getMyPresence(actors.lifeguardA, "2026-10-12");
    expect(db.journey.findMany.mock.calls[0]![0].where).toEqual({
      userId: actors.lifeguardA.id,
    });
    expect(db.scheduleEntry.findMany.mock.calls[0]![0].where).toMatchObject({
      userId: actors.lifeguardA.id,
      schedule: { status: { in: ["CONFIRMED", "CHANGED"] } },
    });
  });
});
