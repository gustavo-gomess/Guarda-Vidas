import { beforeEach, describe, expect, it, vi } from "vitest";

import { actors, POST_A, POST_B } from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getPostForActor, listAssignableUsers, listVisiblePosts } =
  await import("@/features/posts/queries");

const postRow = (id: string) => ({
  id,
  name: `Posto ${id.slice(0, 4)}`,
  active: true,
  coordinators: [],
  assignments: [],
});

let db: {
  post: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  user: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  db = {
    post: {
      // The database would return any post asked for: the check must not rely on it.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        postRow(where.id),
      ),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
  mocks.getDb.mockReturnValue(db);
});

describe("opening a post by id (URL tampering)", () => {
  it.each([
    ["lifeguard", actors.lifeguardA],
    ["captain", actors.captainA],
    ["coordinator", actors.coordinatorA],
  ])(
    "the %s cannot open a post outside their assignments",
    async (_label, who) => {
      expect(await getPostForActor(who, POST_B)).toBeNull();
      expect(db.post.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["lifeguard", actors.lifeguardA],
    ["coordinator", actors.coordinatorA],
    ["authority", actors.authority],
    ["admin", actors.admin],
  ])("the %s opens an authorized post", async (_label, who) => {
    expect(await getPostForActor(who, POST_A)).toMatchObject({ id: POST_A });
  });

  it("reports management rights from the policy, not from the client", async () => {
    expect(await getPostForActor(actors.coordinatorA, POST_A)).toMatchObject({
      canManageTeam: true,
      canManageCoordinators: false,
    });
    expect(await getPostForActor(actors.authority, POST_A)).toMatchObject({
      canManageTeam: false,
      canManageCoordinators: false,
    });
    expect(await getPostForActor(actors.lifeguardA, POST_A)).toMatchObject({
      canManageTeam: false,
    });
  });
});

describe("listing posts", () => {
  it("restricts a lifeguard to their own posts", async () => {
    await listVisiblePosts(actors.lifeguardA);
    expect(db.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [POST_A] } } }),
    );
  });

  it("gives the authority every post", async () => {
    await listVisiblePosts(actors.authority);
    expect(db.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

describe("team pickers", () => {
  it("are not available to users who cannot manage the team", async () => {
    expect(await listAssignableUsers(actors.lifeguardA, POST_A)).toBeNull();
    expect(await listAssignableUsers(actors.coordinatorA, POST_B)).toBeNull();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
