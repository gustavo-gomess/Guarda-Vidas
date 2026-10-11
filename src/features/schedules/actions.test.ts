import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDbDate } from "@/lib/dates";
import {
  actors,
  form,
  LIFEGUARD_ID,
  POST_A,
  POST_B,
} from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  getDb: vi.fn(),
  warn: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() },
}));

const {
  addEntryAction,
  confirmScheduleAction,
  createScheduleAction,
  removeEntryAction,
} = await import("@/features/schedules/actions");

const SCHEDULE_ID = "55555555-5555-4555-8555-555555555555";
const WINDOW_ID = "66666666-6666-4666-8666-666666666666";
const ENTRY_ID = "77777777-7777-4777-8777-777777777777";
const FORBIDDEN = {
  ok: false,
  error: "Você não tem permissão para esta operação.",
};

// Far in the future so "past day" rules do not interfere.
const START = "2099-01-10";
const DAY2 = "2099-01-11";

function fakeDb(scheduleStatus = "PROPOSED", postId = POST_A) {
  const schedule = {
    status: scheduleStatus,
    postId,
    windowId: WINDOW_ID,
    window: { startDate: toDbDate(START) },
    post: { status: "OPERATING" },
    _count: { entries: 0 },
  };
  const tx = {
    $executeRaw: vi.fn(),
    schedule: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(schedule),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: SCHEDULE_ID }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        name: "Ana",
        role: "LIFEGUARD",
        active: true,
        assignments: [{ postId }],
      }),
    },
    scheduleEntry: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      delete: vi.fn(),
    },
    availability: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ day1: true, day2: true, day3: true }),
    },
    auditLog: { create: vi.fn() },
  };
  const db = {
    schedule: {
      findUnique: vi.fn().mockResolvedValue({ postId }),
      findUniqueOrThrow: vi.fn(),
    },
    scheduleEntry: {
      findUnique: vi.fn().mockResolvedValue({
        scheduleId: SCHEDULE_ID,
        schedule: { postId },
      }),
    },
    post: {
      findUnique: vi.fn().mockResolvedValue({ status: "OPERATING" }),
    },
    availabilityWindow: {
      findUnique: vi.fn().mockResolvedValue({ startDate: toDbDate(START) }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx, schedule };
}

let db: ReturnType<typeof fakeDb>["db"];
let tx: ReturnType<typeof fakeDb>["tx"];
let schedule: ReturnType<typeof fakeDb>["schedule"];

function useDb(status = "PROPOSED", postId = POST_A) {
  ({ db, tx, schedule } = fakeDb(status, postId));
  mocks.getDb.mockReturnValue(db);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

const addForm = (extra: Record<string, string> = {}) =>
  form({
    scheduleId: SCHEDULE_ID,
    userId: LIFEGUARD_ID,
    date: DAY2,
    reason: "",
    ...extra,
  });

describe("who can change a schedule (server-side)", () => {
  it.each([
    ["authority", actors.authority],
    ["administrator outside the area", actors.admin],
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
  ])("denies the %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await addEntryAction(null, addForm())).toEqual(FORBIDDEN);
    expect(
      await removeEntryAction(null, form({ entryId: ENTRY_ID, reason: "" })),
    ).toEqual(FORBIDDEN);
    expect(
      await confirmScheduleAction(null, form({ scheduleId: SCHEDULE_ID })),
    ).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith("authz.denied", expect.anything());
  });

  it("authorizes against the schedule's post, not anything in the form", async () => {
    // The schedule belongs to post B; coordinator A adds a forged postId.
    useDb("PROPOSED", POST_B);
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    expect(await addEntryAction(null, addForm({ postId: POST_A }))).toEqual(
      FORBIDDEN,
    );
    expect(tx.scheduleEntry.create).not.toHaveBeenCalled();
  });

  it("denies building a schedule for a post outside the area", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    expect(
      await createScheduleAction(
        null,
        form({ postId: POST_B, windowId: WINDOW_ID }),
      ),
    ).toEqual(FORBIDDEN);
    mocks.requireActor.mockResolvedValue(actors.authority);
    expect(
      await createScheduleAction(
        null,
        form({ postId: POST_A, windowId: WINDOW_ID }),
      ),
    ).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("building a proposal", () => {
  beforeEach(() => mocks.requireActor.mockResolvedValue(actors.coordinatorA));

  it("creates an empty proposal and opens it", async () => {
    db.schedule.findUnique.mockResolvedValue(null);
    await expect(
      createScheduleAction(null, form({ postId: POST_A, windowId: WINDOW_ID })),
    ).rejects.toThrow(`NEXT_REDIRECT /escalas/${SCHEDULE_ID}`);
    expect(tx.schedule.create).toHaveBeenCalledWith({
      data: { postId: POST_A, windowId: WINDOW_ID },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "schedule.create",
        postId: POST_A,
      }),
    });
  });

  it("adds an available team member without changing the state", async () => {
    const result = await addEntryAction(null, addForm());
    expect(result).toEqual({ ok: true, data: undefined });
    expect(tx.$executeRaw).toHaveBeenCalled(); // schedule row locked
    expect(tx.scheduleEntry.create).toHaveBeenCalledWith({
      data: {
        scheduleId: SCHEDULE_ID,
        userId: LIFEGUARD_ID,
        date: toDbDate(DAY2),
        createdById: actors.coordinatorA.id,
      },
    });
    expect(tx.schedule.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "schedule.entry_add",
        actorId: actors.coordinatorA.id,
        entityId: SCHEDULE_ID,
        postId: POST_A,
      }),
    });
  });

  it("refuses a conflict with another post on the same day", async () => {
    tx.scheduleEntry.findUnique.mockResolvedValue({
      schedule: { postId: POST_B, post: { name: "Posto Norte" } },
    });
    expect(await addEntryAction(null, addForm())).toEqual({
      ok: false,
      error:
        "Conflito: este guarda-vidas já está escalado no posto Posto Norte neste dia.",
    });
    expect(tx.scheduleEntry.create).not.toHaveBeenCalled();
  });

  it("turns the database's unique constraint into a conflict message", async () => {
    // Two coordinators scheduling the same person at the same moment.
    tx.scheduleEntry.create.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    const result = await addEntryAction(null, addForm());
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Conflito/),
    });
  });

  it("requires a justification for someone who did not declare availability", async () => {
    tx.availability.findUnique.mockResolvedValue(null);
    expect((await addEntryAction(null, addForm())).ok).toBe(false);
    const result = await addEntryAction(
      null,
      addForm({ reason: "Reforço por evento" }),
    );
    expect(result.ok).toBe(true);
    expect(tx.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        reason: "Reforço por evento",
        after: expect.objectContaining({ availability: "NOT_SENT" }),
      }),
    });
  });

  it("does not confirm an empty proposal", async () => {
    expect(
      await confirmScheduleAction(null, form({ scheduleId: SCHEDULE_ID })),
    ).toEqual({
      ok: false,
      error: "Inclua pelo menos um guarda-vidas antes de confirmar.",
    });
    expect(tx.schedule.update).not.toHaveBeenCalled();
  });

  it("confirms a proposal, recording who confirmed it", async () => {
    schedule._count.entries = 3;
    const result = await confirmScheduleAction(
      null,
      form({ scheduleId: SCHEDULE_ID }),
    );
    expect(result.ok).toBe(true);
    expect(tx.schedule.update).toHaveBeenCalledWith({
      where: { id: SCHEDULE_ID },
      data: {
        status: "CONFIRMED",
        confirmedAt: expect.any(Date),
        confirmedById: actors.coordinatorA.id,
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "schedule.confirm",
        before: { status: "PROPOSED" },
        after: { status: "CONFIRMED", entries: 3 },
      }),
    });
  });
});

describe("changing a confirmed schedule", () => {
  beforeEach(() => {
    useDb("CONFIRMED");
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
  });

  it("requires a justification to add someone", async () => {
    const result = await addEntryAction(null, addForm());
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/justificativa/),
    });
    expect(tx.scheduleEntry.create).not.toHaveBeenCalled();
  });

  it("marks the schedule as changed and keeps the justification", async () => {
    const result = await addEntryAction(
      null,
      addForm({ reason: "Substituição por atestado" }),
    );
    expect(result.ok).toBe(true);
    expect(tx.schedule.update).toHaveBeenCalledWith({
      where: { id: SCHEDULE_ID },
      data: { status: "CHANGED" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        before: { status: "CONFIRMED" },
        after: expect.objectContaining({ status: "CHANGED", date: DAY2 }),
        reason: "Substituição por atestado",
      }),
    });
  });

  it("requires a justification to remove someone", async () => {
    tx.scheduleEntry.findUnique.mockResolvedValue({
      userId: LIFEGUARD_ID,
      date: toDbDate(DAY2),
      user: { name: "Ana" },
      schedule: { status: "CONFIRMED", postId: POST_A },
    });
    expect(
      (await removeEntryAction(null, form({ entryId: ENTRY_ID, reason: "" })))
        .ok,
    ).toBe(false);
    expect(tx.scheduleEntry.delete).not.toHaveBeenCalled();

    const result = await removeEntryAction(
      null,
      form({ entryId: ENTRY_ID, reason: "Licença médica" }),
    );
    expect(result.ok).toBe(true);
    expect(tx.scheduleEntry.delete).toHaveBeenCalledWith({
      where: { id: ENTRY_ID },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "schedule.entry_remove",
        before: expect.objectContaining({
          guardaVidas: "Ana",
          status: "CONFIRMED",
        }),
        after: { status: "CHANGED" },
        reason: "Licença médica",
      }),
    });
  });

  it("cannot be confirmed again", async () => {
    schedule._count.entries = 2;
    expect(
      await confirmScheduleAction(null, form({ scheduleId: SCHEDULE_ID })),
    ).toEqual({ ok: false, error: "Esta escala já foi confirmada." });
  });
});
