/**
 * The whole scheduling flow against a real, disposable PostgreSQL with
 * migrations applied: real Server Actions, queries, constraints and
 * transactions. Only the session is replaced (the actor is chosen per step).
 * Skipped unless TEST_DATABASE_URL is set. NEVER point it at real data.
 */
import { randomInt, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { Actor } from "@/lib/auth/policy";
import { addDays, operationalToday, toDbDate } from "@/lib/dates";

// eslint-disable-next-line no-restricted-properties -- test-only connection
const url = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  db: null as unknown,
}));
vi.mock("@/lib/auth/session", () => ({
  requireActor: async () => state.actor,
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug() {}, info() {}, warn() {}, error() {} },
}));

const { openWindowAction, submitAvailabilityAction } =
  await import("@/features/availability/actions");
const {
  addEntryAction,
  confirmScheduleAction,
  createScheduleAction,
  removeEntryAction,
} = await import("@/features/schedules/actions");
const { getScheduleForActor, listEntries } =
  await import("@/features/schedules/queries");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe.skipIf(!url)("schedules against PostgreSQL", () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 6);
  // A far-future window that earlier runs on the same database did not use.
  const start = addDays(
    operationalToday(new Date()),
    400 + 3 * randomInt(0, 50_000),
  );
  const [day1, day2] = [start, addDays(start, 1)];

  const actors = {} as Record<
    "coordA" | "coordB" | "authority" | "ana" | "bia",
    Actor
  >;
  let postA: string;
  let postB: string;
  let windowId: string;

  async function user(name: string, role: Actor["role"]) {
    const row = await db.user.create({
      data: {
        username: `it-${tag}-${name}`,
        name: `${name} ${tag}`,
        role,
        passwordHash: "x",
        mustChangePassword: false,
      },
    });
    return row.id;
  }

  function actor(
    id: string,
    role: Actor["role"],
    extra: Partial<Actor> = {},
  ): Actor {
    return {
      id,
      name: id,
      role,
      isAdmin: false,
      mustChangePassword: false,
      coordinatedPostIds: [],
      assignedPostIds: [],
      captainPostIds: [],
      ...extra,
    };
  }

  async function as<T>(who: Actor, run: () => Promise<T>): Promise<T> {
    state.actor = who;
    return run();
  }

  async function openSchedule(who: Actor, postId: string) {
    await expect(
      as(who, () => createScheduleAction(null, form({ postId, windowId }))),
    ).rejects.toThrow(/NEXT_REDIRECT \/escalas\//);
    const schedule = await db.schedule.findUniqueOrThrow({
      where: { postId_windowId: { postId, windowId } },
    });
    return schedule.id;
  }

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    state.db = db;

    const [coordA, coordB, authority, ana, bia] = await Promise.all([
      user("coordA", "COORDINATOR"),
      user("coordB", "COORDINATOR"),
      user("authority", "AUTHORITY"),
      user("ana", "LIFEGUARD"),
      user("bia", "LIFEGUARD"),
    ]);
    postA = (
      await db.post.create({
        data: { code: `A-${tag}`, name: `Posto A ${tag}` },
      })
    ).id;
    postB = (
      await db.post.create({
        data: { code: `B-${tag}`, name: `Posto B ${tag}` },
      })
    ).id;
    await db.postCoordinator.createMany({
      data: [
        { postId: postA, userId: coordA },
        { postId: postB, userId: coordB },
      ],
    });
    // Ana is in both teams; Bia only in post A.
    await db.postAssignment.createMany({
      data: [
        { postId: postA, userId: ana },
        { postId: postB, userId: ana },
        { postId: postA, userId: bia },
      ],
    });

    actors.coordA = actor(coordA, "COORDINATOR", {
      coordinatedPostIds: [postA],
    });
    actors.coordB = actor(coordB, "COORDINATOR", {
      coordinatedPostIds: [postB],
    });
    actors.authority = actor(authority, "AUTHORITY");
    actors.ana = actor(ana, "LIFEGUARD", { assignedPostIds: [postA, postB] });
    actors.bia = actor(bia, "LIFEGUARD", { assignedPostIds: [postA] });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("runs the flow from availability to a changed schedule", async () => {
    // 1. A coordinator opens the window; an overlapping one is refused.
    expect(
      await as(actors.coordA, () =>
        openWindowAction(null, form({ startDate: start })),
      ),
    ).toEqual({ ok: true, data: undefined });
    windowId = (
      await db.availabilityWindow.findUniqueOrThrow({
        where: { startDate: toDbDate(start) },
      })
    ).id;
    expect(
      await as(actors.coordB, () =>
        openWindowAction(null, form({ startDate: day2 })),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Já existe uma janela/),
    });

    // 2. Ana declares days 1 and 2; Bia sends nothing.
    expect(
      await as(actors.ana, () =>
        submitAvailabilityAction(
          null,
          form({ windowId, day1: "on", day2: "on", note: "" }),
        ),
      ),
    ).toMatchObject({ ok: true });
    // Declared availability is not a schedule.
    expect(
      await db.scheduleEntry.count({ where: { userId: actors.ana.id } }),
    ).toBe(0);

    // 3. Coordinator A builds a proposal for post A.
    const scheduleA = await openSchedule(actors.coordA, postA);
    expect(
      await as(actors.coordA, () =>
        addEntryAction(
          null,
          form({
            scheduleId: scheduleA,
            userId: actors.ana.id,
            date: day1,
            reason: "",
          }),
        ),
      ),
    ).toMatchObject({ ok: true });
    // Bia did not declare availability: a justification is required.
    const biaForm = {
      scheduleId: scheduleA,
      userId: actors.bia.id,
      date: day1,
    };
    expect(
      await as(actors.coordA, () =>
        addEntryAction(null, form({ ...biaForm, reason: "" })),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/não declarou/),
    });
    expect(
      await as(actors.coordA, () =>
        addEntryAction(
          null,
          form({ ...biaForm, reason: "Reforço de fim de semana" }),
        ),
      ),
    ).toMatchObject({ ok: true });

    // 4. Coordinator B cannot put Ana at post B on the same day.
    const scheduleB = await openSchedule(actors.coordB, postB);
    expect(
      await as(actors.coordB, () =>
        addEntryAction(
          null,
          form({
            scheduleId: scheduleB,
            userId: actors.ana.id,
            date: day1,
            reason: "",
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: `Conflito: este guarda-vidas já está escalado no posto Posto A ${tag} neste dia.`,
    });
    // Coordinator B cannot touch post A's schedule either.
    expect(
      await as(actors.coordB, () =>
        confirmScheduleAction(null, form({ scheduleId: scheduleA })),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/permissão/) });

    // 5. Until confirmed, Ana does not see the proposal.
    const period = { from: day1, to: addDays(day1, 2) };
    expect(await as(actors.ana, () => listEntries(actors.ana, period))).toEqual(
      [],
    );

    // 6. Authority reads it, but cannot change or confirm it.
    const readOnly = await getScheduleForActor(actors.authority, scheduleA);
    expect(readOnly).toMatchObject({ status: "PROPOSED", canManage: false });
    expect(readOnly?.days[0]?.entries).toHaveLength(2);
    expect(
      await as(actors.authority, () =>
        confirmScheduleAction(null, form({ scheduleId: scheduleA })),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/permissão/) });

    // 7. Coordinator A confirms; now Ana sees her day, only hers.
    expect(
      await as(actors.coordA, () =>
        confirmScheduleAction(null, form({ scheduleId: scheduleA })),
      ),
    ).toMatchObject({ ok: true });
    const anaView = await listEntries(actors.ana, period);
    expect(anaView).toHaveLength(1);
    expect(anaView[0]).toMatchObject({
      date: day1,
      user: { id: actors.ana.id },
      schedule: { status: "CONFIRMED" },
    });

    // 8. Changing the confirmed schedule needs a justification and marks it.
    const biaEntry = await db.scheduleEntry.findFirstOrThrow({
      where: { scheduleId: scheduleA, userId: actors.bia.id },
    });
    expect(
      await as(actors.coordA, () =>
        removeEntryAction(null, form({ entryId: biaEntry.id, reason: "" })),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await as(actors.coordA, () =>
        removeEntryAction(
          null,
          form({ entryId: biaEntry.id, reason: "Atestado médico" }),
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      (await db.schedule.findUniqueOrThrow({ where: { id: scheduleA } }))
        .status,
    ).toBe("CHANGED");

    // 9. Every relevant step is in the history, with author and justification.
    const history = await db.auditLog.findMany({
      where: { entityType: "Schedule", entityId: scheduleA },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((entry) => entry.action)).toEqual([
      "schedule.create",
      "schedule.entry_add",
      "schedule.entry_add",
      "schedule.confirm",
      "schedule.entry_remove",
    ]);
    expect(history.every((entry) => entry.actorId === actors.coordA.id)).toBe(
      true,
    );
    expect(history.map((entry) => entry.reason)).toEqual([
      null,
      null,
      "Reforço de fim de semana",
      null,
      "Atestado médico",
    ]);
    expect(
      await db.auditLog.count({
        where: { action: "availability.submit", entityId: actors.ana.id },
      }),
    ).toBe(1);
  });

  it("refuses a second post on the same day in the database itself", async () => {
    const scheduleB = await db.schedule.findUniqueOrThrow({
      where: { postId_windowId: { postId: postB, windowId } },
    });
    // Bypassing the application: the unique constraint still holds.
    await expect(
      db.scheduleEntry.create({
        data: {
          scheduleId: scheduleB.id,
          userId: actors.ana.id,
          date: toDbDate(day1),
          createdById: actors.coordB.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
