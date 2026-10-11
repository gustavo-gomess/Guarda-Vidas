import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDbDate } from "@/lib/dates";
import { actors, POST_A, POST_B } from "../../../tests/support/actors";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const {
  getChecklistForActor,
  getPostItems,
  listChecklistOverview,
  listMaterialProblems,
  listMyChecklists,
} = await import("@/features/checklists/queries");

const JOURNEY_ID = "15151515-1515-4151-8151-151515151515";

function fakeDb(owner: string, postId: string) {
  return {
    journey: {
      findMany: vi.fn().mockResolvedValue([]),
      // The database would return any journey asked for.
      findUnique: vi.fn().mockResolvedValue({
        id: JOURNEY_ID,
        date: toDbDate("2026-10-12"),
        userId: owner,
        postId,
        user: { name: "Ana" },
        post: { code: "A", name: "Posto A" },
        checklist: null,
      }),
    },
    checklistItemVersion: { count: vi.fn().mockResolvedValue(3) },
    checklistAnswer: { findMany: vi.fn().mockResolvedValue([]) },
    checklistItem: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

let db: ReturnType<typeof fakeDb>;
function useDb(owner = actors.lifeguardA.id, postId = POST_A) {
  db = fakeDb(owner, postId);
  mocks.getDb.mockReturnValue(db);
}
beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("a checklist belongs to its assumption and person", () => {
  it("its lifeguard opens and fills it", async () => {
    expect(
      await getChecklistForActor(actors.lifeguardA, JOURNEY_ID),
    ).toMatchObject({ canFill: true, progress: "PENDING", hasItems: true });
  });

  it("a colleague of the same post cannot open it", async () => {
    expect(await getChecklistForActor(actors.captainA, JOURNEY_ID)).toBeNull();
  });

  it("the coordination and authority read it without filling", async () => {
    expect(
      await getChecklistForActor(actors.coordinatorA, JOURNEY_ID),
    ).toMatchObject({ canFill: false });
    expect(
      await getChecklistForActor(actors.authority, JOURNEY_ID),
    ).toMatchObject({ canFill: false });
  });

  it("a coordinator of another area cannot open it", async () => {
    useDb(actors.lifeguardA.id, POST_B);
    expect(
      await getChecklistForActor(actors.coordinatorA, JOURNEY_ID),
    ).toBeNull();
  });
});

describe("lists", () => {
  it("lifeguards list only their own journeys", async () => {
    await listMyChecklists(actors.lifeguardA);
    expect(db.journey.findMany.mock.calls[0]![0].where).toEqual({
      userId: actors.lifeguardA.id,
    });
    expect(await listMyChecklists(actors.coordinatorA)).toBeNull();
  });

  it("overview and problems are limited to the coordinator's area", async () => {
    await listChecklistOverview(actors.coordinatorA, { date: "2026-10-12" });
    expect(db.journey.findMany.mock.calls[0]![0].where.postId).toEqual({
      in: [POST_A],
    });
    await listMaterialProblems(actors.coordinatorA, {
      from: "2026-10-01",
      to: "2026-10-12",
      postId: POST_B,
    });
    expect(
      db.checklistAnswer.findMany.mock.calls[0]![0].where.revision.currentOf
        .postId,
    ).toEqual({ in: [] });
  });

  it("are not available to lifeguards", async () => {
    expect(
      await listChecklistOverview(actors.lifeguardA, { date: "2026-10-12" }),
    ).toBeNull();
    expect(
      await listMaterialProblems(actors.captainA, {
        from: "2026-10-01",
        to: "2026-10-12",
      }),
    ).toBeNull();
  });

  it("problems only come from current answers of sent checklists", async () => {
    await listMaterialProblems(actors.authority, {
      from: "2026-10-01",
      to: "2026-10-12",
    });
    const where = db.checklistAnswer.findMany.mock.calls[0]![0].where;
    expect(where.state).toEqual({ in: ["MISSING", "DAMAGED", "INADEQUATE"] });
    expect(where.revision.currentOf).toMatchObject({ status: "SUBMITTED" });
  });

  it("the overview filters by progress", async () => {
    db.journey.findMany.mockResolvedValue([
      {
        id: "j1",
        user: { name: "A" },
        post: { code: "A", name: "A" },
        checklist: null,
      },
      {
        id: "j2",
        user: { name: "B" },
        post: { code: "A", name: "A" },
        checklist: {
          status: "DRAFT",
          submittedAt: null,
          currentRevision: null,
        },
      },
    ]);
    const pending = await listChecklistOverview(actors.authority, {
      date: "2026-10-12",
      progress: "PENDING",
    });
    expect(pending?.map((row) => row.id)).toEqual(["j1"]);
  });
});

describe("item list", () => {
  it("the post's lifeguards read it; only the coordinator manages it", async () => {
    expect(await getPostItems(actors.lifeguardA, POST_A)).toMatchObject({
      canManage: false,
    });
    expect(await getPostItems(actors.coordinatorA, POST_A)).toMatchObject({
      canManage: true,
    });
    expect(await getPostItems(actors.lifeguardA, POST_B)).toBeNull();
  });
});
