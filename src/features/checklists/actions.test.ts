import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDbDate } from "@/lib/dates";
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

const {
  createItemAction,
  saveChecklistAction,
  setItemActiveAction,
  startChecklistAction,
  updateItemAction,
} = await import("@/features/checklists/actions");

const ITEM_ID = "14141414-1414-4141-8141-141414141414";
const JOURNEY_ID = "15151515-1515-4151-8151-151515151515";
const CHECKLIST_ID = "16161616-1616-4161-8161-161616161616";
const LINE_ID = "17171717-1717-4171-8171-171717171717";
const REQUEST_ID = "18181818-1818-4181-8181-181818181818";
const FORBIDDEN = {
  ok: false,
  error: "Você não tem permissão para esta operação.",
};

const currentVersion = {
  version: 1,
  label: "Boia",
  guidance: "",
  position: 1,
  active: true,
};

function fakeDb(postId = POST_A, owner = actors.lifeguardA.id) {
  const tx = {
    $executeRaw: vi.fn(),
    checklistItem: {
      create: vi.fn().mockResolvedValue({ id: ITEM_ID }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "i1",
          versions: [{ id: "v1", ...currentVersion }],
        },
        {
          id: "i2",
          versions: [
            { id: "v2", ...currentVersion, label: "Velho", active: false },
          ],
        },
      ]),
    },
    checklistItemVersion: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(currentVersion),
    },
    checklist: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: CHECKLIST_ID }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        userId: owner,
        status: "DRAFT",
        lines: [{ id: LINE_ID }],
        currentRevision: null,
      }),
      update: vi.fn(),
    },
    checklistLine: { createMany: vi.fn() },
    checklistRevision: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    checklistAnswer: { createMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    checklistItem: { findUnique: vi.fn().mockResolvedValue({ postId }) },
    journey: {
      findUnique: vi.fn().mockResolvedValue({
        userId: owner,
        postId,
        date: toDbDate("2026-10-12"),
      }),
    },
    checklist: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ userId: owner, postId, journeyId: JOURNEY_ID }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
}

let db: ReturnType<typeof fakeDb>["db"];
let tx: ReturnType<typeof fakeDb>["tx"];

function useDb(postId = POST_A, owner = actors.lifeguardA.id) {
  ({ db, tx } = fakeDb(postId, owner));
  mocks.getDb.mockReturnValue(db);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

const newItem = (postId: string) =>
  form({ postId, label: "Rádio", guidance: "", position: "2" });
const editItem = (extra: Record<string, string> = {}) =>
  form({
    itemId: ITEM_ID,
    label: "Boia",
    guidance: "",
    position: "1",
    ...extra,
  });

describe("who edits the item list", () => {
  it.each([
    ["authority", actors.authority],
    ["administrator outside the area", actors.admin],
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
  ])("denies the %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await createItemAction(null, newItem(POST_A))).toEqual(FORBIDDEN);
    expect(
      await updateItemAction(null, editItem({ label: "Novo nome" })),
    ).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("denies a coordinator on another post, using the item's post", async () => {
    useDb(POST_B);
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    expect(
      await updateItemAction(
        null,
        editItem({ label: "Novo nome", postId: POST_A }),
      ),
    ).toEqual(FORBIDDEN);
    expect(await createItemAction(null, newItem(POST_B))).toEqual(FORBIDDEN);
  });
});

describe("item versions (the post's coordinator)", () => {
  beforeEach(() => mocks.requireActor.mockResolvedValue(actors.coordinatorA));

  it("creates an item as version 1, with history in the post", async () => {
    expect((await createItemAction(null, newItem(POST_A))).ok).toBe(true);
    expect(tx.checklistItemVersion.create).toHaveBeenCalledWith({
      data: {
        itemId: ITEM_ID,
        version: 1,
        label: "Rádio",
        guidance: "",
        position: 2,
        active: true,
        createdById: actors.coordinatorA.id,
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "checklist_item.create",
        postId: POST_A,
      }),
    });
  });

  it("edits by adding a new version, never changing the old one", async () => {
    expect(
      (await updateItemAction(null, editItem({ label: "Boia circular" }))).ok,
    ).toBe(true);
    expect(tx.checklistItemVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, label: "Boia circular" }),
    });
    expect(tx.$executeRaw).toHaveBeenCalled(); // item locked
  });

  it("does not create a version when nothing changed", async () => {
    expect((await updateItemAction(null, editItem())).ok).toBe(true);
    expect(tx.checklistItemVersion.create).not.toHaveBeenCalled();
  });

  it("deactivates as a new version", async () => {
    await setItemActiveAction(null, form({ itemId: ITEM_ID, active: "false" }));
    expect(tx.checklistItemVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, active: false }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "checklist_item.deactivate" }),
    });
  });

  it("validates the fields", async () => {
    expect(
      await createItemAction(
        null,
        form({ postId: POST_A, label: "x", guidance: "", position: "0" }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        label: [expect.any(String)],
        position: [expect.any(String)],
      },
    });
  });
});

describe("starting the checklist of an assumption", () => {
  const start = () =>
    startChecklistAction(null, form({ journeyId: JOURNEY_ID }));

  it.each([
    ["another lifeguard", actors.captainA],
    ["the post's coordinator", actors.coordinatorA],
    ["authority", actors.authority],
  ])("only its lifeguard starts it, not %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await start()).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("copies only the active current items into its own lines", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    expect((await start()).ok).toBe(true);
    expect(tx.checklist.create).toHaveBeenCalledWith({
      data: {
        journeyId: JOURNEY_ID,
        userId: actors.lifeguardA.id,
        postId: POST_A,
        date: toDbDate("2026-10-12"),
      },
    });
    expect(tx.checklistLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          checklistId: CHECKLIST_ID,
          itemId: "i1",
          itemVersionId: "v1",
          position: 1,
          label: "Boia",
          guidance: "",
        },
      ],
    });
  });

  it("starting twice keeps the first checklist", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    tx.checklist.findUnique.mockResolvedValue({ id: CHECKLIST_ID });
    expect((await start()).ok).toBe(true);
    expect(tx.checklist.create).not.toHaveBeenCalled();
  });

  it("explains when the post has no items", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    tx.checklistItem.findMany.mockResolvedValue([]);
    expect(await start()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/não tem lista de itens/),
    });
  });
});

describe("saving", () => {
  const payload = (extra = {}) => ({
    checklistId: CHECKLIST_ID,
    requestId: REQUEST_ID,
    answers: [{ lineId: LINE_ID, state: "OK" as const, note: "" }],
    generalNote: "",
    submit: true,
    reason: "",
    ...extra,
  });

  it.each([
    ["another lifeguard", actors.captainA],
    ["the post's coordinator", actors.coordinatorA],
    ["authority", actors.authority],
  ])("is refused to %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await saveChecklistAction(payload())).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("stores the submission under the request id, with history", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    expect(await saveChecklistAction(payload())).toEqual({
      ok: true,
      data: {
        kind: "SUBMISSION",
        number: 1,
        status: "SUBMITTED",
        alreadySaved: false,
      },
    });
    expect(tx.checklistRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: REQUEST_ID,
        number: 1,
        kind: "SUBMISSION",
        authorId: actors.lifeguardA.id,
      }),
    });
    expect(tx.checklist.update).toHaveBeenCalledWith({
      where: { id: CHECKLIST_ID },
      data: {
        currentRevisionId: REQUEST_ID,
        status: "SUBMITTED",
        submittedAt: expect.any(Date),
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "checklist.submit",
        postId: POST_A,
      }),
    });
  });

  it("answers a repeated request without storing it again", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    tx.checklistRevision.findUnique.mockResolvedValue({
      checklistId: CHECKLIST_ID,
      kind: "SUBMISSION",
      number: 1,
    });
    expect(await saveChecklistAction(payload())).toMatchObject({
      ok: true,
      data: { alreadySaved: true },
    });
    expect(tx.checklistRevision.create).not.toHaveBeenCalled();
  });

  it("retries once when two identical requests collide in the database", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    tx.checklistRevision.create.mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    tx.checklistRevision.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        checklistId: CHECKLIST_ID,
        kind: "SUBMISSION",
        number: 1,
      });
    expect(await saveChecklistAction(payload())).toMatchObject({
      ok: true,
      data: { alreadySaved: true },
    });
  });

  it("rejects malformed payloads", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    expect(
      (
        await saveChecklistAction(
          payload({ answers: [{ lineId: "x", state: "BROKEN", note: "" }] }),
        )
      ).ok,
    ).toBe(false);
    expect(db.checklist.findUnique).not.toHaveBeenCalled();
  });
});
