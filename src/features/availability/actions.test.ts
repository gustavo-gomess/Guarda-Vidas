import { beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, operationalToday, toDbDate } from "@/lib/dates";
import { actors, form, OTHER_USER_ID } from "../../../tests/support/actors";

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

const { openWindowAction, setWindowStatusAction, submitAvailabilityAction } =
  await import("@/features/availability/actions");

const WINDOW_ID = "66666666-6666-4666-8666-666666666666";
const FORBIDDEN = {
  ok: false,
  error: "Você não tem permissão para esta operação.",
};
const today = operationalToday(new Date());

function fakeDb() {
  const tx = {
    availabilityWindow: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi
        .fn()
        .mockResolvedValue({ status: "OPEN", startDate: toDbDate(today) }),
      create: vi.fn().mockResolvedValue({ id: WINDOW_ID }),
      update: vi.fn(),
    },
    availability: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const db = {
    availabilityWindow: {
      findUnique: vi.fn().mockResolvedValue({ status: "OPEN" }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
}

let db: ReturnType<typeof fakeDb>["db"];
let tx: ReturnType<typeof fakeDb>["tx"];

beforeEach(() => {
  vi.clearAllMocks();
  ({ db, tx } = fakeDb());
  mocks.getDb.mockReturnValue(db);
});

describe("opening availability windows", () => {
  it.each([
    ["authority", actors.authority],
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
  ])("is denied to the %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await openWindowAction(null, form({ startDate: today }))).toEqual(
      FORBIDDEN,
    );
    expect(
      await setWindowStatusAction(
        null,
        form({ windowId: WINDOW_ID, status: "CLOSED" }),
      ),
    ).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("lets a coordinator open a three-day window, with history", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    const start = addDays(today, 3);
    const result = await openWindowAction(null, form({ startDate: start }));
    expect(result.ok).toBe(true);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(tx.availabilityWindow.create).toHaveBeenCalledWith({
      data: { startDate: toDbDate(start), createdById: actors.coordinatorA.id },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "availability_window.open" }),
    });
  });

  it("refuses past days and overlapping windows", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    expect(
      (await openWindowAction(null, form({ startDate: addDays(today, -1) })))
        .ok,
    ).toBe(false);

    tx.availabilityWindow.findMany.mockResolvedValue([
      { startDate: toDbDate(addDays(today, 4)) },
    ]);
    expect(
      await openWindowAction(null, form({ startDate: addDays(today, 3) })),
    ).toEqual({
      ok: false,
      error: "Já existe uma janela que cobre algum desses dias.",
    });
    expect(tx.availabilityWindow.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid date with a field message", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    expect(
      await openWindowAction(null, form({ startDate: "2026-02-30" })),
    ).toMatchObject({
      ok: false,
      fieldErrors: { startDate: ["Informe uma data válida."] },
    });
  });
});

describe("sending availability", () => {
  const answer = (extra: Record<string, string> = {}) =>
    form({ windowId: WINDOW_ID, day1: "on", day3: "on", note: "", ...extra });

  it("records it for the signed-in lifeguard, ignoring any userId sent", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    const result = await submitAvailabilityAction(
      null,
      answer({ userId: OTHER_USER_ID }),
    );
    expect(result.ok).toBe(true);
    expect(tx.availability.upsert).toHaveBeenCalledWith({
      where: {
        windowId_userId: { windowId: WINDOW_ID, userId: actors.lifeguardA.id },
      },
      create: {
        windowId: WINDOW_ID,
        userId: actors.lifeguardA.id,
        day1: true,
        day2: false,
        day3: true,
        note: "",
      },
      update: { day1: true, day2: false, day3: true, note: "" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "availability.submit",
        entityId: actors.lifeguardA.id,
      }),
    });
  });

  it("records changes as updates, with the previous answer", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    tx.availability.findUnique.mockResolvedValue({
      day1: false,
      day2: false,
      day3: false,
      note: "",
    });
    await submitAvailabilityAction(null, answer());
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "availability.update",
        before: { day1: false, day2: false, day3: false, note: "" },
      }),
    });
  });

  it("is refused once the window is closed", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    tx.availabilityWindow.findUnique.mockResolvedValue({
      status: "CLOSED",
      startDate: toDbDate(today),
    });
    expect(await submitAvailabilityAction(null, answer())).toEqual({
      ok: false,
      error: "Esta janela está encerrada e não aceita mais disponibilidade.",
    });
    expect(tx.availability.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["coordinator", actors.coordinatorA],
    ["authority", actors.authority],
  ])("is only for lifeguards, not the %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await submitAvailabilityAction(null, answer())).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
