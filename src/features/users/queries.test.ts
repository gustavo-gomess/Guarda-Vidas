import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  actors,
  LIFEGUARD_ID,
  OTHER_USER_ID,
  POST_A,
  POST_B,
} from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getUserForActor, listUsersForAdmin } =
  await import("@/features/users/queries");

function userRow(id: string, postId: string) {
  return {
    id,
    username: `user-${id.slice(0, 4)}`,
    name: "Pessoa",
    role: "LIFEGUARD",
    isAdmin: false,
    active: true,
    mustChangePassword: false,
    createdAt: new Date(),
    lockedUntil: null,
    coordinatedPosts: [],
    assignments: [{ isCaptain: false, post: { id: postId, name: "Posto" } }],
  };
}

let db: {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === OTHER_USER_ID
          ? userRow(OTHER_USER_ID, POST_B)
          : userRow(where.id, POST_A),
      ),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  mocks.getDb.mockReturnValue(db);
});

describe("another user's data (horizontal access)", () => {
  it("a lifeguard can read their own record", async () => {
    expect(
      await getUserForActor(actors.lifeguardA, LIFEGUARD_ID),
    ).toMatchObject({
      id: LIFEGUARD_ID,
    });
  });

  it("a lifeguard cannot read another user's record by changing the id", async () => {
    expect(await getUserForActor(actors.lifeguardA, OTHER_USER_ID)).toBeNull();
  });

  it("a coordinator cannot read a user from another area", async () => {
    expect(
      await getUserForActor(actors.coordinatorA, OTHER_USER_ID),
    ).toBeNull();
    // But can read a lifeguard from their own area.
    expect(
      await getUserForActor(actors.coordinatorA, LIFEGUARD_ID),
    ).not.toBeNull();
  });

  it("never selects the password hash or login counters", async () => {
    await getUserForActor(actors.admin, OTHER_USER_ID);
    const select = (db.user.findUnique.mock.calls[0]![0] as { select: object })
      .select;
    expect(select).not.toHaveProperty("passwordHash");
    expect(select).not.toHaveProperty("failedLoginAttempts");
  });
});

describe("user list", () => {
  it.each([
    ["authority", actors.authority],
    ["coordinator", actors.coordinatorA],
    ["lifeguard", actors.lifeguardA],
  ])("is not available to the %s", async (_label, who) => {
    expect(await listUsersForAdmin(who)).toBeNull();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("is available to the administrator without password hashes", async () => {
    await listUsersForAdmin(actors.admin);
    const select = (db.user.findMany.mock.calls[0]![0] as { select: object })
      .select;
    expect(select).not.toHaveProperty("passwordHash");
  });
});
