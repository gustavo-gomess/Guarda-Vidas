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

const {
  annulOccurrenceAction,
  createCategoryAction,
  createOccurrenceAction,
  updateCategoryAction,
} = await import("@/features/occurrences/actions");

const CATEGORY_ID = "20202020-2020-4202-8202-202020202020";
const RECORD_ID = "21212121-2121-4212-8212-212121212121";
const FORBIDDEN = {
  ok: false,
  error: "Você não tem permissão para esta operação.",
};

const fields = [
  {
    key: "quantidade",
    label: "Quantidade",
    type: "number",
    required: true,
    options: [],
  },
];

function fakeDb(
  record = {
    postId: POST_A,
    authorId: actors.lifeguardA.id,
    annulment: null as null | { id: string },
  },
) {
  const tx = {
    $executeRaw: vi.fn(),
    occurrenceCategory: {
      create: vi.fn().mockResolvedValue({ id: CATEGORY_ID }),
    },
    occurrenceCategoryVersion: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({
        id: "v1",
        version: 1,
        name: "Águas-vivas",
        description: "",
        active: true,
        fields,
      }),
    },
    occurrence: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: RECORD_ID,
        recordedAt: new Date("2026-10-12T13:00:00Z"),
      }),
    },
    occurrenceAnnulment: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const db = {
    occurrence: { findUnique: vi.fn().mockResolvedValue(record) },
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
beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

const payload = (extra: Record<string, unknown> = {}) => ({
  id: RECORD_ID,
  postId: POST_A,
  categoryId: CATEGORY_ID,
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  description: "Muitas caravelas na faixa de areia",
  values: { quantidade: "40" },
  ...extra,
});

describe("categories (administrators only)", () => {
  const category = form({
    name: "Águas-vivas",
    description: "",
    fields: JSON.stringify(fields),
  });

  it.each([
    ["coordinator", actors.coordinatorA],
    ["authority", actors.authority],
    ["lifeguard", actors.lifeguardA],
  ])("denies the %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await createCategoryAction(null, category)).toEqual(FORBIDDEN);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("creates version 1; editing creates version 2", async () => {
    mocks.requireActor.mockResolvedValue(actors.admin);
    expect((await createCategoryAction(null, category)).ok).toBe(true);
    expect(tx.occurrenceCategoryVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 1,
        name: "Águas-vivas",
        fields,
      }),
    });
    vi.clearAllMocks();
    useDb();
    const result = await updateCategoryAction(
      null,
      form({
        categoryId: CATEGORY_ID,
        name: "Águas-vivas e caravelas",
        description: "",
        active: "true",
        fields: JSON.stringify(fields),
      }),
    );
    expect(result.ok).toBe(true);
    expect(tx.occurrenceCategoryVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 2,
        name: "Águas-vivas e caravelas",
      }),
    });
  });

  it("rejects invalid field definitions", async () => {
    mocks.requireActor.mockResolvedValue(actors.admin);
    expect(
      (
        await createCategoryAction(
          null,
          form({ name: "X1", description: "", fields: "{bad" }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await createCategoryAction(
          null,
          form({
            name: "X1",
            description: "",
            fields: JSON.stringify([
              { key: "A b", label: "x", type: "text", required: false },
            ]),
          }),
        )
      ).ok,
    ).toBe(false);
  });
});

describe("registering (lifeguards of the post's team)", () => {
  it.each([
    ["coordinator of the post", actors.coordinatorA, POST_A],
    ["authority", actors.authority, POST_A],
    ["lifeguard of another post", actors.lifeguardA, POST_B],
  ])("denies the %s", async (_label, who, postId) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await createOccurrenceAction(payload({ postId }))).toEqual(
      FORBIDDEN,
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("stores the record with the category version and history in the post", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    expect(await createOccurrenceAction(payload())).toEqual({
      ok: true,
      data: {
        id: RECORD_ID,
        recordedAt: "2026-10-12T13:00:00.000Z",
        alreadySaved: false,
      },
    });
    expect(tx.occurrence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: RECORD_ID,
        authorId: actors.lifeguardA.id,
        categoryVersionId: "v1",
        values: { quantidade: 40 },
      }),
      select: expect.anything(),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "occurrence.create",
        postId: POST_A,
      }),
    });
  });

  it("recognizes a repeated request", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    tx.occurrence.findUnique.mockResolvedValue({
      authorId: actors.lifeguardA.id,
      recordedAt: new Date("2026-10-12T13:00:00Z"),
    });
    expect(await createOccurrenceAction(payload())).toMatchObject({
      ok: true,
      data: { alreadySaved: true },
    });
    expect(tx.occurrence.create).not.toHaveBeenCalled();
  });

  it("returns field errors", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    expect(await createOccurrenceAction(payload({ values: {} }))).toMatchObject(
      {
        ok: false,
        fieldErrors: { quantidade: [expect.any(String)] },
      },
    );
  });
});

describe("annulment", () => {
  const annul = (reason = "Registrado no posto errado") =>
    annulOccurrenceAction(null, form({ occurrenceId: RECORD_ID, reason }));

  it.each([
    ["the author", actors.lifeguardA],
    ["the post's coordinator", actors.coordinatorA],
  ])("is allowed to %s, keeping the record", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect((await annul()).ok).toBe(true);
    expect(tx.occurrenceAnnulment.create).toHaveBeenCalledWith({
      data: {
        occurrenceId: RECORD_ID,
        byId: who.id,
        reason: "Registrado no posto errado",
      },
    });
  });

  it.each([
    ["another lifeguard", actors.captainA],
    ["authority", actors.authority],
  ])("is denied to %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect(await annul()).toEqual(FORBIDDEN);
  });

  it("needs a reason and happens once", async () => {
    mocks.requireActor.mockResolvedValue(actors.lifeguardA);
    expect((await annul("")).ok).toBe(false);
    useDb({
      postId: POST_A,
      authorId: actors.lifeguardA.id,
      annulment: { id: "x" },
    });
    expect(await annul()).toEqual({
      ok: false,
      error: "Este registro já foi anulado.",
    });
  });
});
