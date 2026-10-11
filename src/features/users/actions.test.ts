import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  actors,
  form,
  LIFEGUARD_ID,
  OTHER_USER_ID,
} from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  getDb: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/session", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));

const { createUserAction, resetPasswordAction, updateUserAction } =
  await import("@/features/users/actions");

function fakeDb() {
  const tx = {
    user: {
      create: vi.fn().mockResolvedValue({ id: OTHER_USER_ID }),
      update: vi.fn(),
    },
    session: { deleteMany: vi.fn() },
    postCoordinator: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    postAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const db = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: LIFEGUARD_ID,
        name: "Bia",
        role: "LIFEGUARD",
        isAdmin: false,
        active: true,
      }),
      count: vi.fn().mockResolvedValue(1),
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

const newUserForm = () =>
  form({ username: "nova.pessoa", name: "Nova Pessoa", role: "LIFEGUARD" });

const updateForm = (overrides: Record<string, string> = {}) =>
  form({
    userId: LIFEGUARD_ID,
    name: "Bia",
    role: "LIFEGUARD",
    active: "on",
    ...overrides,
  });

describe("user administration is admin-only on the server", () => {
  it.each([
    ["authority", actors.authority],
    ["coordinator", actors.coordinatorA],
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
  ])("denies every user operation to the %s", async (_label, who) => {
    mocks.requireActor.mockResolvedValue(who);
    expect((await createUserAction(null, newUserForm())).ok).toBe(false);
    expect(
      (await updateUserAction(null, updateForm({ role: "COORDINATOR" }))).ok,
    ).toBe(false);
    expect(
      (await resetPasswordAction(null, form({ userId: LIFEGUARD_ID }))).ok,
    ).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("does not let a user grant themselves admin by forging the form", async () => {
    // A coordinator sends their own id with isAdmin=on.
    mocks.requireActor.mockResolvedValue(actors.coordinatorA);
    const result = await updateUserAction(
      null,
      updateForm({
        userId: actors.coordinatorA.id,
        role: "COORDINATOR",
        isAdmin: "on",
      }),
    );
    expect(result.ok).toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe("user administration by an administrator", () => {
  beforeEach(() => mocks.requireActor.mockResolvedValue(actors.admin));

  it("creates a user with a temporary password that is never logged", async () => {
    const result = await createUserAction(null, newUserForm());
    if (!result.ok) throw new Error(result.error);

    const { temporaryPassword } = result.data;
    expect(temporaryPassword).toHaveLength(16);
    const created = tx.user.create.mock.calls[0]![0] as {
      data: { passwordHash: string; mustChangePassword: boolean };
    };
    expect(created.data.passwordHash).toMatch(/^scrypt\$/);
    expect(created.data.passwordHash).not.toContain(temporaryPassword);
    expect(created.data.mustChangePassword).toBe(true);

    const everythingLogged = JSON.stringify([
      ...Object.values(mocks.log).flatMap((fn) => fn.mock.calls),
      ...tx.auditLog.create.mock.calls,
    ]);
    expect(everythingLogged).not.toContain(temporaryPassword);
    expect(everythingLogged).not.toContain(created.data.passwordHash);
  });

  it("refuses to make a lifeguard an administrator", async () => {
    const result = await createUserAction(
      null,
      form({ username: "x.y", name: "X Y", role: "LIFEGUARD", isAdmin: "on" }),
    );
    expect(result.ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("deactivating a user revokes their sessions and audits the change", async () => {
    // An unchecked "Ativo" checkbox is simply absent from the submitted form.
    const unchecked = form({
      userId: LIFEGUARD_ID,
      name: "Bia",
      role: "LIFEGUARD",
    });
    const result = await updateUserAction(null, unchecked);

    expect(result.ok).toBe(true);
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: LIFEGUARD_ID },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user.update",
        actorId: actors.admin.id,
        before: { active: true },
        after: { active: false },
      }),
    });
  });

  it("changing the role removes incompatible assignments, with history", async () => {
    tx.postAssignment.findMany.mockResolvedValue([
      { postId: "p1", isCaptain: true },
    ]);
    const result = await updateUserAction(
      null,
      updateForm({ role: "COORDINATOR" }),
    );
    expect(result.ok).toBe(true);
    expect(tx.postAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: LIFEGUARD_ID },
    });
    const actions = tx.auditLog.create.mock.calls.map(
      ([arg]) => (arg as { data: { action: string } }).data.action,
    );
    expect(actions).toEqual(["post.assignment_remove", "user.update"]);
  });

  it("resets a password: new temporary hash, unlocked, sessions revoked", async () => {
    const result = await resetPasswordAction(
      null,
      form({ userId: LIFEGUARD_ID }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: LIFEGUARD_ID },
      data: expect.objectContaining({
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      }),
    });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: LIFEGUARD_ID },
    });
    const audit = JSON.stringify(tx.auditLog.create.mock.calls);
    expect(audit).not.toContain(result.data.temporaryPassword);
    expect(audit).not.toContain("passwordHash");
  });

  it("does not reset the administrator's own password here", async () => {
    const result = await resetPasswordAction(
      null,
      form({ userId: actors.admin.id }),
    );
    expect(result.ok).toBe(false);
  });
});
