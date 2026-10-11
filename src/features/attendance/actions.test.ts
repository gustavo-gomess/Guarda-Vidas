import { beforeEach, describe, expect, it, vi } from "vitest";

import { actors, form, POST_A, POST_B } from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  getDb: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() },
}));

const { decideAttendanceAction } =
  await import("@/features/attendance/actions");

const RECORD_ID = "12121212-1212-4121-8121-121212121212";
const FORBIDDEN = {
  ok: false,
  error: "Você não tem permissão para esta operação.",
};

function fakeDb(postId = POST_A, status = "AWAITING_VALIDATION") {
  const tx = {
    $executeRaw: vi.fn(),
    attendanceRecord: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ status }),
      update: vi.fn(),
    },
    attendanceDecision: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    attendanceRecord: {
      findUnique: vi.fn().mockResolvedValue({ postId, journeyId: "j-1" }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
}

let db: ReturnType<typeof fakeDb>["db"];
let tx: ReturnType<typeof fakeDb>["tx"];

function useDb(postId = POST_A, status = "AWAITING_VALIDATION") {
  ({ db, tx } = fakeDb(postId, status));
  mocks.getDb.mockReturnValue(db);
}

const decide = (decision: string, reason = "") =>
  decideAttendanceAction(null, form({ recordId: RECORD_ID, decision, reason }));

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("who decides on presence records", () => {
  it.each([
    ["authority", actors.authority],
    ["administrator outside the area", actors.admin],
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
  ])("denies the %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await decide("VALIDATED")).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("uses the record's post from the database, not the form", async () => {
    useDb(POST_B);
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    const result = await decideAttendanceAction(
      null,
      form({
        recordId: RECORD_ID,
        decision: "VALIDATED",
        reason: "",
        postId: POST_A,
      }),
    );
    expect(result).toEqual(FORBIDDEN);
  });
});

describe("validation and rejection by the post's coordinator", () => {
  beforeEach(() => mocks.requireActor.mockResolvedValue(actors.coordinatorA));

  it("validates, keeping the previous state in the decision and history", async () => {
    expect(await decide("VALIDATED")).toEqual({ ok: true, data: undefined });
    expect(tx.$executeRaw).toHaveBeenCalled(); // row locked
    expect(tx.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: RECORD_ID },
      data: { status: "VALIDATED" },
    });
    expect(tx.attendanceDecision.create).toHaveBeenCalledWith({
      data: {
        recordId: RECORD_ID,
        decidedById: actors.coordinatorA.id,
        fromStatus: "AWAITING_VALIDATION",
        toStatus: "VALIDATED",
        reason: "",
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "attendance.decide",
        actorId: actors.coordinatorA.id,
        postId: POST_A,
      }),
    });
  });

  it("requires a justification to reject", async () => {
    expect(await decide("REJECTED")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/justificativa/),
    });
    expect(tx.attendanceRecord.update).not.toHaveBeenCalled();

    expect((await decide("REJECTED", "Não estava no posto")).ok).toBe(true);
    expect(tx.attendanceDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toStatus: "REJECTED",
        reason: "Não estava no posto",
      }),
    });
  });

  it("requires a justification to revise a rejection", async () => {
    useDb(POST_A, "REJECTED");
    expect((await decide("VALIDATED")).ok).toBe(false);
    expect((await decide("VALIDATED", "Comprovado por rádio")).ok).toBe(true);
  });

  it("rejects an unknown decision", async () => {
    expect((await decide("DELETED")).ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
