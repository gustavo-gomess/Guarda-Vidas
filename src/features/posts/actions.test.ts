import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@/lib/auth/session", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() },
}));

const {
  addLifeguardAction,
  createPostAction,
  removeLifeguardAction,
  setCaptainAction,
  addCoordinatorAction,
} = await import("@/features/posts/actions");

function fakeDb() {
  const tx = {
    post: { create: vi.fn() },
    postAssignment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    postCoordinator: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const db = {
    post: {
      findUnique: vi.fn().mockResolvedValue({ id: POST_A, active: true }),
    },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ role: "LIFEGUARD", active: true }),
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

const teamForm = (postId: string) => form({ postId, userId: LIFEGUARD_ID });

describe("team management is enforced on the server", () => {
  it("lets a coordinator manage the team of a post in their area", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    const result = await addLifeguardAction(null, teamForm(POST_A));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(tx.postAssignment.create).toHaveBeenCalledWith({
      data: { postId: POST_A, userId: LIFEGUARD_ID },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: actors.coordinatorA.id,
        action: "post.assignment_add",
        postId: POST_A,
      }),
    });
  });

  it("denies a coordinator who sends another area's post id", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    const result = await addLifeguardAction(null, teamForm(POST_B));

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/permissão/),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.post.findUnique).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      "authz.denied",
      expect.objectContaining({
        action: "post.assignment_add",
        postId: POST_B,
      }),
    );
  });

  it.each([
    ["authority", actors.authority],
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
  ])("denies the %s, whatever the interface shows", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    for (const action of [addLifeguardAction, removeLifeguardAction]) {
      const result = await action(null, teamForm(POST_A));
      expect(result.ok).toBe(false);
    }
    const captain = await setCaptainAction(
      null,
      form({ postId: POST_A, userId: LIFEGUARD_ID, isCaptain: "true" }),
    );
    expect(captain.ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed ids before touching the database", async () => {
    mocks.requireActor.mockResolvedValue(actors.admin);
    const result = await addLifeguardAction(
      null,
      form({ postId: "../../etc", userId: LIFEGUARD_ID }),
    );
    expect(result).toEqual({ ok: false, error: "Dados inválidos." });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("refuses to assign a user who is not an active lifeguard", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    db.user.findUnique.mockResolvedValue({ role: "COORDINATOR", active: true });
    const result = await addLifeguardAction(null, teamForm(POST_A));
    expect(result).toMatchObject({ ok: false });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("captain is an assignment set by an authorized user", () => {
  it("a coordinator sets the captain and the previous one is cleared", async () => {
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    tx.postAssignment.findUnique.mockResolvedValue({ isCaptain: false });
    tx.postAssignment.findMany.mockResolvedValue([{ userId: "previous" }]);

    const result = await setCaptainAction(
      null,
      form({ postId: POST_A, userId: LIFEGUARD_ID, isCaptain: "true" }),
    );

    expect(result.ok).toBe(true);
    const actions = tx.auditLog.create.mock.calls.map(
      ([arg]) => (arg as { data: { action: string } }).data.action,
    );
    expect(actions).toEqual(["post.captain_unset", "post.captain_set"]);
  });
});

describe("post and area administration is admin-only", () => {
  it.each([
    ["authority", actors.authority],
    ["coordinator", actors.coordinatorA],
    ["lifeguard", actors.lifeguardA],
  ])(
    "denies creating posts and coordinator areas to the %s",
    async (_label, who) => {
      mocks.requireActor.mockResolvedValue(who);
      expect((await createPostAction(null, form({ name: "Posto 9" }))).ok).toBe(
        false,
      );
      expect(
        (
          await addCoordinatorAction(
            null,
            form({ postId: POST_A, userId: LIFEGUARD_ID }),
          )
        ).ok,
      ).toBe(false);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it("allows the administrator and audits the creation", async () => {
    mocks.requireActor.mockResolvedValue(actors.admin);
    tx.post.create.mockResolvedValue({ id: POST_B, name: "Posto 9" });
    const result = await createPostAction(null, form({ name: "Posto 9" }));
    expect(result.ok).toBe(true);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "post.create",
        actorId: actors.admin.id,
      }),
    });
  });
});
