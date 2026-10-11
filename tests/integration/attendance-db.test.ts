/**
 * Presence against a real, disposable PostgreSQL with migrations applied:
 * the real service, decision action, constraints and triggers.
 * Skipped unless TEST_DATABASE_URL is set. NEVER point it at real data.
 */
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RegistrationInput } from "@/features/attendance/rules";
import { PrismaClient } from "@/generated/prisma/client";
import type { Actor } from "@/lib/auth/policy";
import { operationalToday, toDbDate } from "@/lib/dates";

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
vi.mock("@/lib/logger", () => ({
  logger: { debug() {}, info() {}, warn() {}, error() {} },
}));

const { registerAttendance } = await import("@/features/attendance/service");
const { decideAttendanceAction } =
  await import("@/features/attendance/actions");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe.skipIf(!url)("presence against PostgreSQL", () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 6);
  const today = operationalToday(new Date());
  let postId: string;
  const actors = {} as Record<
    "ana" | "bia" | "caio" | "coord" | "authority",
    Actor
  >;

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

  function entry(
    who: Actor,
    overrides: Partial<RegistrationInput> = {},
  ): RegistrationInput {
    return {
      id: randomUUID(),
      userId: who.id,
      kind: "CHECK_IN",
      mode: "online",
      deviceTime: new Date(),
      clockOffsetMs: 0,
      postId,
      location: { status: "UNAVAILABLE" },
      ...overrides,
    };
  }

  const decide = (
    who: Actor,
    recordId: string,
    decision: string,
    reason = "",
  ) => {
    state.actor = who;
    return decideAttendanceAction(null, form({ recordId, decision, reason }));
  };

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    state.db = db;
    const user = async (name: string, role: Actor["role"]) =>
      (
        await db.user.create({
          data: {
            username: `it-${tag}-${name}`,
            name,
            role,
            passwordHash: "x",
            mustChangePassword: false,
          },
        })
      ).id;
    const ids = {
      ana: await user("ana", "LIFEGUARD"),
      bia: await user("bia", "LIFEGUARD"),
      caio: await user("caio", "LIFEGUARD"),
      coord: await user("coord", "COORDINATOR"),
      authority: await user("authority", "AUTHORITY"),
    };
    postId = (
      await db.post.create({
        data: { code: `PR-${tag}`, name: `Presença ${tag}` },
      })
    ).id;
    await db.postCoordinator.create({ data: { postId, userId: ids.coord } });
    await db.postAssignment.createMany({
      data: [ids.ana, ids.bia, ids.caio].map((userId) => ({ postId, userId })),
    });

    // Confirmed schedule for today with Ana and Bia (Caio is not scheduled).
    const window =
      (await db.availabilityWindow.findUnique({
        where: { startDate: toDbDate(today) },
      })) ??
      (await db.availabilityWindow.create({
        data: { startDate: toDbDate(today), createdById: ids.coord },
      }));
    const schedule = await db.schedule.create({
      data: { postId, windowId: window.id, status: "CONFIRMED" },
    });
    await db.scheduleEntry.createMany({
      data: [ids.ana, ids.bia].map((userId) => ({
        scheduleId: schedule.id,
        userId,
        date: toDbDate(today),
        createdById: ids.coord,
      })),
    });

    for (const name of ["ana", "bia", "caio"] as const) {
      actors[name] = actor(ids[name], "LIFEGUARD", {
        assignedPostIds: [postId],
      });
    }
    actors.coord = actor(ids.coord, "COORDINATOR", {
      coordinatedPostIds: [postId],
    });
    actors.authority = actor(ids.authority, "AUTHORITY");
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("online entry and exit: server time, validated, one journey", async () => {
    const checkIn = entry(actors.ana);
    const result = await registerAttendance(db, actors.ana, checkIn);
    expect(result).toMatchObject({
      ok: true,
      created: true,
      record: { origin: "ONLINE", status: "VALIDATED" },
    });

    // A second entry the same day is refused (no duplicate journey).
    expect(
      await registerAttendance(db, actors.ana, entry(actors.ana)),
    ).toMatchObject({
      ok: false,
      code: "ALREADY_CHECKED_IN",
    });

    const exit = entry(actors.ana, { kind: "CHECK_OUT" });
    expect(await registerAttendance(db, actors.ana, exit)).toMatchObject({
      ok: true,
      record: { kind: "CHECK_OUT", status: "VALIDATED" },
    });
    expect(
      await registerAttendance(
        db,
        actors.ana,
        entry(actors.ana, { kind: "CHECK_OUT" }),
      ),
    ).toMatchObject({ ok: false, code: "ALREADY_CHECKED_OUT" });
    // Exit without internet: no approved rule, nothing stored.
    expect(
      await registerAttendance(
        db,
        actors.ana,
        entry(actors.ana, { kind: "CHECK_OUT", mode: "offline" }),
      ),
    ).toMatchObject({ ok: false, code: "OFFLINE_EXIT_NOT_ALLOWED" });

    expect(await db.journey.count({ where: { userId: actors.ana.id } })).toBe(
      1,
    );
    expect(
      await db.attendanceRecord.count({ where: { userId: actors.ana.id } }),
    ).toBe(2);
  });

  it("offline entry: provisional, idempotent on repeated sync, preserved duplicate", async () => {
    const deviceTime = new Date(Date.now() - 60 * 60 * 1000);
    const offline = entry(actors.bia, {
      mode: "offline",
      deviceTime,
      clockOffsetMs: 800,
    });

    const first = await registerAttendance(db, actors.bia, offline);
    expect(first).toMatchObject({
      ok: true,
      created: true,
      record: {
        origin: "OFFLINE",
        status: "AWAITING_VALIDATION",
        effectiveTime: deviceTime.toISOString(),
      },
    });

    // The device did not get the answer and sends it again, several times.
    const repeats = await Promise.all([
      registerAttendance(db, actors.bia, offline),
      registerAttendance(db, actors.bia, offline),
      registerAttendance(db, actors.bia, { ...offline, mode: "online" }),
    ]);
    for (const repeat of repeats) {
      expect(repeat).toMatchObject({
        ok: true,
        created: false,
        record: { id: offline.id },
      });
    }
    // Same id with different data never overwrites the original.
    expect(
      await registerAttendance(db, actors.bia, {
        ...offline,
        postId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "PAYLOAD_CONFLICT" });

    // A second, different offline entry of the same day is kept for review.
    const second = await registerAttendance(
      db,
      actors.bia,
      entry(actors.bia, {
        mode: "offline",
        deviceTime: new Date(Date.now() - 30 * 60 * 1000),
      }),
    );
    expect(second).toMatchObject({
      ok: true,
      record: { status: "UNDER_REVIEW" },
    });
    expect(second.ok && second.record.flags).toContain("DUPLICATE");

    expect(await db.journey.count({ where: { userId: actors.bia.id } })).toBe(
      1,
    );
    expect(
      await db.attendanceRecord.count({ where: { userId: actors.bia.id } }),
    ).toBe(2);
    expect(
      await db.attendanceRecord.count({
        where: { userId: actors.bia.id, primaryKind: "CHECK_IN" },
      }),
    ).toBe(1);
  });

  it("the coordinator validates and rejects; every decision is kept", async () => {
    const offline = entry(actors.caio, {
      mode: "offline",
      deviceTime: new Date(Date.now() - 600_000),
    });
    const stored = await registerAttendance(db, actors.caio, offline);
    // Not scheduled: stored, but sent to review.
    expect(stored).toMatchObject({
      ok: true,
      record: { status: "UNDER_REVIEW" },
    });

    // Authority and lifeguards cannot decide.
    expect(
      await decide(actors.authority, offline.id, "VALIDATED"),
    ).toMatchObject({ ok: false });
    expect(await decide(actors.ana, offline.id, "VALIDATED")).toMatchObject({
      ok: false,
    });

    expect(await decide(actors.coord, offline.id, "REJECTED")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/justificativa/),
    });
    expect(
      await decide(actors.coord, offline.id, "REJECTED", "Não estava escalado"),
    ).toEqual({
      ok: true,
      data: undefined,
    });
    expect(
      await decide(
        actors.coord,
        offline.id,
        "VALIDATED",
        "Reforço autorizado por rádio",
      ),
    ).toEqual({
      ok: true,
      data: undefined,
    });

    const decisions = await db.attendanceDecision.findMany({
      where: { recordId: offline.id },
      orderBy: { createdAt: "asc" },
    });
    expect(
      decisions.map((d) => [d.fromStatus, d.toStatus, d.decidedById]),
    ).toEqual([
      [null, "UNDER_REVIEW", null],
      ["UNDER_REVIEW", "REJECTED", actors.coord.id],
      ["REJECTED", "VALIDATED", actors.coord.id],
    ]);
    expect(
      await db.auditLog.findMany({
        where: { entityType: "AttendanceRecord", entityId: offline.id },
        select: { action: true, actorId: true, reason: true },
        orderBy: { createdAt: "asc" },
      }),
    ).toEqual([
      { action: "attendance.sync", actorId: actors.caio.id, reason: null },
      {
        action: "attendance.decide",
        actorId: actors.coord.id,
        reason: "Não estava escalado",
      },
      {
        action: "attendance.decide",
        actorId: actors.coord.id,
        reason: "Reforço autorizado por rádio",
      },
    ]);

    // The original data cannot change and nothing can be deleted.
    await expect(
      db.$executeRaw`UPDATE "AttendanceRecord" SET "deviceTime" = now() WHERE "id" = ${offline.id}::uuid`,
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRaw`DELETE FROM "AttendanceRecord" WHERE "id" = ${offline.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "AttendanceDecision" WHERE "recordId" = ${offline.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "Journey" WHERE "userId" = ${actors.caio.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    const original = await db.attendanceRecord.findUniqueOrThrow({
      where: { id: offline.id },
    });
    expect(original.deviceTime).toEqual(offline.deviceTime);
  });

  it("refuses records of another account and of non-lifeguards", async () => {
    expect(
      await registerAttendance(
        db,
        actors.ana,
        entry(actors.bia, { mode: "offline" }),
      ),
    ).toMatchObject({ ok: false, code: "WRONG_USER" });
    expect(
      await registerAttendance(db, actors.coord, entry(actors.coord)),
    ).toMatchObject({ ok: false, httpStatus: 403 });
  });
});
