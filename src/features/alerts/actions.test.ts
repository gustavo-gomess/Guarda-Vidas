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

const { transitionAlertAction } = await import("@/features/alerts/actions");

const ALERT_ID = "19191919-1919-4191-8191-191919191919";

function fakeDb(
  status = "OPEN",
  postId = POST_A,
  authorId = actors.captainA.id,
) {
  const tx = {
    $executeRaw: vi.fn(),
    reinforcementAlert: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ status }),
      update: vi.fn(),
    },
    alertEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    reinforcementAlert: {
      findUnique: vi.fn().mockResolvedValue({ postId, authorId }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
}

let db: ReturnType<typeof fakeDb>["db"];
let tx: ReturnType<typeof fakeDb>["tx"];
function useDb(...args: Parameters<typeof fakeDb>) {
  ({ db, tx } = fakeDb(...args));
  mocks.getDb.mockReturnValue(db);
}

const act = (
  action: string,
  expectedStatus: string,
  extra: Record<string, string> = {},
) =>
  transitionAlertAction(
    null,
    form({
      alertId: ALERT_ID,
      action,
      expectedStatus,
      note: "",
      confirmed: "on",
      ...extra,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("permissions", () => {
  it.each([
    ["captain (author)", actors.captainA],
    ["authority", actors.authority],
    ["administrator outside the area", actors.admin],
  ])("the %s cannot acknowledge", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect((await act("ACKNOWLEDGE", "OPEN")).ok).toBe(false);
    expect(tx.reinforcementAlert.update).not.toHaveBeenCalled();
  });

  it("a lifeguard who cannot see the alert gets 'not found'", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    expect(await act("CANCEL", "OPEN", { note: "Engano" })).toEqual({
      ok: false,
      error: "Alerta não encontrado.",
    });
  });

  it("a coordinator of another post cannot act", async () => {
    useDb("OPEN", POST_B, "someone");
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    expect((await act("ACKNOWLEDGE", "OPEN")).ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("the author can cancel, with a reason", async () => {
    mocks.requireActor.mockResolvedValue(actors.captainA);
    expect(
      (await act("CANCEL", "OPEN", { note: "Resolvido no local" })).ok,
    ).toBe(true);
    expect(tx.alertEvent.create).toHaveBeenCalledWith({
      data: {
        alertId: ALERT_ID,
        actorId: actors.captainA.id,
        fromStatus: "OPEN",
        toStatus: "CANCELLED",
        note: "Resolvido no local",
      },
    });
  });
});

describe("acknowledge, attend, close (post's coordinator)", () => {
  beforeEach(() => mocks.requireActor.mockResolvedValue(actors.coordinatorA));

  it("acknowledges with an event and history entry", async () => {
    expect(await act("ACKNOWLEDGE", "OPEN")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(tx.$executeRaw).toHaveBeenCalled(); // row locked
    expect(tx.reinforcementAlert.update).toHaveBeenCalledWith({
      where: { id: ALERT_ID },
      data: { status: "ACKNOWLEDGED" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "alert.acknowledge",
        actorId: actors.coordinatorA.id,
        postId: POST_A,
      }),
    });
  });

  it("refuses without the confirmation box (no accidental acknowledgement)", async () => {
    const result = await transitionAlertAction(
      null,
      form({
        alertId: ALERT_ID,
        action: "ACKNOWLEDGE",
        expectedStatus: "OPEN",
        note: "",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Confirme/),
    });
    expect(tx.reinforcementAlert.update).not.toHaveBeenCalled();
  });

  it("refuses when another coordinator acted first", async () => {
    useDb("ACKNOWLEDGED");
    expect(await act("ACKNOWLEDGE", "OPEN")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/mudou/),
    });
  });

  it("puts in progress and closes with the outcome", async () => {
    useDb("ACKNOWLEDGED");
    expect((await act("START", "ACKNOWLEDGED")).ok).toBe(true);
    useDb("IN_PROGRESS");
    expect((await act("CLOSE", "IN_PROGRESS")).ok).toBe(false); // no outcome
    expect(
      (
        await act("CLOSE", "IN_PROGRESS", {
          note: "Dois guarda-vidas enviados",
        })
      ).ok,
    ).toBe(true);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "alert.close",
        reason: "Dois guarda-vidas enviados",
      }),
    });
  });

  it("does not change a closed alert", async () => {
    useDb("CLOSED");
    expect((await act("CANCEL", "CLOSED", { note: "Tarde demais" })).ok).toBe(
      false,
    );
    expect(tx.reinforcementAlert.update).not.toHaveBeenCalled();
  });
});
