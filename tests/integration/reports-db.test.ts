/**
 * Panels and daily closing against a real, disposable PostgreSQL: a real
 * day is built with every module's actions, then summarized and closed.
 * Skipped unless TEST_DATABASE_URL is set. NEVER point it at real data.
 */
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
const checklists = await import("@/features/checklists/actions");
const occurrences = await import("@/features/occurrences/actions");
const { createAlert } = await import("@/features/alerts/service");
const { transitionAlertAction } = await import("@/features/alerts/actions");
const reports = await import("@/features/reports/actions");
const { getOverview, getClosingForActor } =
  await import("@/features/reports/queries");
const { loadSummaries } = await import("@/features/reports/load");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe.skipIf(!url)("panels and daily closing against PostgreSQL", () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 6);
  const today = operationalToday(new Date());
  let postId: string;
  let otherPostId: string;
  const actors = {} as Record<
    | "ana"
    | "bia"
    | "caio"
    | "dani"
    | "coord"
    | "coord2"
    | "authority"
    | "admin",
    Actor
  >;
  const ids = {} as Record<keyof typeof actors, string>;

  const as = <T>(who: Actor, run: () => Promise<T>) => {
    state.actor = who;
    return run();
  };
  const actor = (
    id: string,
    role: Actor["role"],
    extra: Partial<Actor> = {},
  ): Actor => ({
    id,
    name: id,
    role,
    isAdmin: false,
    mustChangePassword: false,
    coordinatedPostIds: [],
    assignedPostIds: [],
    captainPostIds: [],
    ...extra,
  });
  const presence = (
    who: Actor,
    mode: "online" | "offline",
    kind: "CHECK_IN" | "CHECK_OUT" = "CHECK_IN",
  ) =>
    registerAttendance(db, who, {
      id: randomUUID(),
      userId: who.id,
      kind,
      mode,
      deviceTime: new Date(Date.now() - (mode === "offline" ? 3_600_000 : 0)),
      clockOffsetMs: 0,
      postId,
      location: { status: "UNAVAILABLE" },
    });
  const journeyOf = async (who: Actor) =>
    (
      await db.journey.findUniqueOrThrow({
        where: { userId_date: { userId: who.id, date: toDbDate(today) } },
      })
    ).id;
  async function sendChecklist(who: Actor, problem: boolean) {
    const journeyId = await journeyOf(who);
    await as(who, () =>
      checklists.startChecklistAction(null, form({ journeyId })),
    );
    const checklist = await db.checklist.findUniqueOrThrow({
      where: { journeyId },
      include: { lines: true },
    });
    return as(who, () =>
      checklists.saveChecklistAction({
        checklistId: checklist.id,
        requestId: randomUUID(),
        answers: checklist.lines.map((line, index) => ({
          lineId: line.id,
          state: problem && index === 0 ? "DAMAGED" : "OK",
          note: "",
        })),
        generalNote: "",
        submit: true,
        reason: "",
      }),
    );
  }
  const live = async () =>
    (await loadSummaries(db, { postIds: [postId] }, today, today))
      .summaries[0]!;
  const close = (action: string, expectedVersion: number, reason = "") =>
    as(actors.coord, () =>
      reports.closingAction(
        null,
        form({
          postId,
          date: today,
          action,
          expectedVersion: String(expectedVersion),
          reason,
        }),
      ),
    );

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    state.db = db;
    const roles = {
      ana: "LIFEGUARD",
      bia: "LIFEGUARD",
      caio: "LIFEGUARD",
      dani: "LIFEGUARD",
      coord: "COORDINATOR",
      coord2: "COORDINATOR",
      authority: "AUTHORITY",
      admin: "COORDINATOR",
    } as const;
    for (const [name, role] of Object.entries(roles) as [
      keyof typeof roles,
      Actor["role"],
    ][]) {
      ids[name] = (
        await db.user.create({
          data: {
            username: `it-${tag}-${name}`,
            name: `${name} ${tag}`,
            role,
            isAdmin: name === "admin",
            passwordHash: "x",
            mustChangePassword: false,
          },
        })
      ).id;
    }
    postId = (
      await db.post.create({
        data: { code: `FC-${tag}`, name: `Fechamento ${tag}` },
      })
    ).id;
    otherPostId = (
      await db.post.create({
        data: { code: `FO-${tag}`, name: `Outro ${tag}` },
      })
    ).id;
    await db.postCoordinator.createMany({
      data: [
        { postId, userId: ids.coord },
        { postId: otherPostId, userId: ids.coord2 },
      ],
    });
    await db.postAssignment.createMany({
      data: (["ana", "bia", "caio", "dani"] as const).map((name) => ({
        postId,
        userId: ids[name],
        isCaptain: name === "ana",
      })),
    });
    for (const name of ["bia", "caio", "dani"] as const) {
      actors[name] = actor(ids[name], "LIFEGUARD", {
        assignedPostIds: [postId],
      });
    }
    actors.ana = actor(ids.ana, "LIFEGUARD", {
      assignedPostIds: [postId],
      captainPostIds: [postId],
    });
    actors.coord = actor(ids.coord, "COORDINATOR", {
      coordinatedPostIds: [postId],
    });
    actors.coord2 = actor(ids.coord2, "COORDINATOR", {
      coordinatedPostIds: [otherPostId],
    });
    actors.authority = actor(ids.authority, "AUTHORITY");
    actors.admin = actor(ids.admin, "COORDINATOR", { isAdmin: true });

    // Confirmed schedule today: Ana, Bia and Dani (Caio is not scheduled).
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
      data: (["ana", "bia", "dani"] as const).map((name) => ({
        scheduleId: schedule.id,
        userId: ids[name],
        date: toDbDate(today),
        createdById: ids.coord,
      })),
    });

    // Checklist items of the post.
    for (const label of ["Boia", "Rádio"]) {
      await as(actors.coord, () =>
        checklists.createItemAction(
          null,
          form({ postId, label, guidance: "", position: "1" }),
        ),
      );
    }

    // Presence: Ana online (validated) with exit; Bia offline (provisional);
    // Caio online but not scheduled (review). Dani does not show up.
    expect(await presence(actors.ana, "online")).toMatchObject({
      ok: true,
      record: { status: "VALIDATED" },
    });
    expect(await presence(actors.ana, "online", "CHECK_OUT")).toMatchObject({
      ok: true,
    });
    expect(await presence(actors.bia, "offline")).toMatchObject({
      ok: true,
      record: { status: "AWAITING_VALIDATION" },
    });
    expect(await presence(actors.caio, "online")).toMatchObject({
      ok: true,
      record: { status: "UNDER_REVIEW" },
    });

    // Checklists: Ana sends with a problem; Bia leaves a draft; Caio none.
    expect(await sendChecklist(actors.ana, true)).toMatchObject({ ok: true });
    const biaJourney = await journeyOf(actors.bia);
    await as(actors.bia, () =>
      checklists.startChecklistAction(null, form({ journeyId: biaJourney })),
    );

    // Occurrences: one valid, one annulled.
    await as(actors.admin, () =>
      occurrences.createCategoryAction(
        null,
        form({ name: `Águas-vivas ${tag}`, description: "", fields: "[]" }),
      ),
    );
    const category = await db.occurrenceCategoryVersion.findFirstOrThrow({
      where: { name: `Águas-vivas ${tag}` },
    });
    const record = (id: string) => ({
      id,
      postId,
      categoryId: category.categoryId,
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      description: "Caravelas",
      values: {},
    });
    const annulledId = randomUUID();
    await as(actors.bia, () =>
      occurrences.createOccurrenceAction(record(randomUUID())),
    );
    await as(actors.bia, () =>
      occurrences.createOccurrenceAction(record(annulledId)),
    );
    await as(actors.bia, () =>
      occurrences.annulOccurrenceAction(
        null,
        form({ occurrenceId: annulledId, reason: "Registro em dobro" }),
      ),
    );

    // An active reinforcement alert from the captain.
    expect(
      await createAlert(db, actors.ana, {
        id: randomUUID(),
        postId,
        description: "Mar agitado",
        deviceTime: new Date(),
        allowAnotherActive: false,
      }),
    ).toMatchObject({ ok: true });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("aggregates the day from every module, keeping provisional data apart", async () => {
    const summary = await live();
    expect(summary.staffing).toEqual({
      scheduled: 3,
      present: 3,
      absent: 1,
      unscheduled: 1,
    });
    expect(summary.presence).toEqual({
      validated: 1,
      provisional: 2,
      rejected: 0,
      withoutExit: 2,
      pendingRecords: 2,
    });
    expect(summary.checklists).toMatchObject({
      submitted: 1,
      incomplete: 1,
      notStarted: 1,
      problems: 1,
    });
    expect(summary.occurrences).toMatchObject({ total: 1, annulled: 1 });
    expect(summary.alerts).toMatchObject({ created: 1, active: 1 });
    expect(summary.pending).toEqual({
      presence: 2,
      checklists: 2,
      alerts: 1,
      total: 5,
    });
    expect(summary.changes).toBeGreaterThan(0);
  });

  it("shows each profile only its scope; the same numbers everywhere", async () => {
    const filters = { from: today, to: today, postId };
    const mine = await getOverview(actors.coord, filters, today);
    const authority = await getOverview(actors.authority, filters, today);
    expect(mine?.rows).toHaveLength(1);
    expect(authority?.rows[0]).toEqual(mine?.rows[0]);
    expect(mine?.total.pending.total).toBe(5);
    expect(mine?.reportsToSend).toBe(1);
    // Another area's coordinator and lifeguards get nothing.
    expect((await getOverview(actors.coord2, filters, today))?.rows).toEqual(
      [],
    );
    expect(await getOverview(actors.ana, filters, today)).toBeNull();
    expect(
      await getClosingForActor(actors.coord2, postId, today, today),
    ).toBeNull();
    // Authority reads without actions; nor can it close.
    expect(
      await getClosingForActor(actors.authority, postId, today, today),
    ).toMatchObject({ actions: [] });
    expect(
      await as(actors.authority, () =>
        reports.closingAction(
          null,
          form({
            postId,
            date: today,
            action: "SUBMIT",
            expectedVersion: "0",
            reason: "",
          }),
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/permissão/) });
    expect(await db.dailyClosing.count({ where: { postId } })).toBe(0);
  });

  it("closes the day without touching the records, keeping every version", async () => {
    const recordsBefore = {
      attendance: await db.attendanceRecord.count({ where: { postId } }),
      occurrences: await db.occurrence.count({ where: { postId } }),
      checklists: await db.checklist.count({ where: { postId } }),
    };

    // 1. Send with the pending items identified; a repeated click fails.
    expect(await close("SUBMIT", 0)).toEqual({ ok: true, data: undefined });
    expect(await close("SUBMIT", 0)).toMatchObject({ ok: false });
    // 2. Consolidation is blocked while there are pending items.
    expect(await close("CONSOLIDATE", 1)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/5 pendência/),
    });

    // 3. The coordination resolves them in their own modules.
    const pendingRecords = await db.attendanceRecord.findMany({
      where: {
        postId,
        status: { in: ["AWAITING_VALIDATION", "UNDER_REVIEW"] },
      },
      include: { user: true },
    });
    for (const record of pendingRecords) {
      const decision =
        record.userId === actors.bia.id ? "VALIDATED" : "REJECTED";
      expect(
        await as(actors.coord, () =>
          decideAttendanceAction(
            null,
            form({
              recordId: record.id,
              decision,
              reason: "Conferido por rádio",
            }),
          ),
        ),
      ).toMatchObject({ ok: true });
    }
    const biaChecklist = await db.checklist.findFirstOrThrow({
      where: { postId, userId: actors.bia.id },
      include: { lines: true },
    });
    await as(actors.bia, () =>
      checklists.saveChecklistAction({
        checklistId: biaChecklist.id,
        requestId: randomUUID(),
        answers: biaChecklist.lines.map((line) => ({
          lineId: line.id,
          state: "OK" as const,
          note: "",
        })),
        generalNote: "",
        submit: true,
        reason: "",
      }),
    );
    expect(await sendChecklist(actors.caio, false)).toMatchObject({ ok: true });
    const alert = await db.reinforcementAlert.findFirstOrThrow({
      where: { postId },
    });
    for (const [action, expected, note] of [
      ["ACKNOWLEDGE", "OPEN", ""],
      ["START", "ACKNOWLEDGED", ""],
      ["CLOSE", "IN_PROGRESS", "Reforço enviado"],
    ] as const) {
      await as(actors.coord, () =>
        transitionAlertAction(
          null,
          form({
            alertId: alert.id,
            action,
            expectedStatus: expected,
            note,
            confirmed: "on",
          }),
        ),
      );
    }
    expect((await live()).pending.total).toBe(0);

    // 4. Now it consolidates.
    expect(await close("CONSOLIDATE", 1)).toEqual({
      ok: true,
      data: undefined,
    });

    // 5. A record arrives late: the live data differs from the frozen one.
    const category = await db.occurrenceCategoryVersion.findFirstOrThrow({
      where: { name: `Águas-vivas ${tag}` },
    });
    await as(actors.bia, () =>
      occurrences.createOccurrenceAction({
        id: randomUUID(),
        postId,
        categoryId: category.categoryId,
        occurredAt: new Date(Date.now() - 30_000).toISOString(),
        description: "Mais caravelas",
        values: {},
      }),
    );
    const page = await getClosingForActor(actors.coord, postId, today, today);
    expect(page?.live.occurrences.total).toBe(2);
    expect(page?.closing?.versions[0]?.summary.occurrences.total).toBe(1);

    // 6. Correction needs a reason and adds version 3.
    expect(await close("CORRECT", 2)).toMatchObject({ ok: false });
    expect(
      await close("CORRECT", 2, "Registro de águas-vivas lançado depois"),
    ).toEqual({
      ok: true,
      data: undefined,
    });

    const closing = await db.dailyClosing.findUniqueOrThrow({
      where: { postId_date: { postId, date: toDbDate(today) } },
      include: { versions: { orderBy: { version: "asc" } } },
    });
    expect(closing.status).toBe("CORRECTED");
    expect(
      closing.versions.map((v) => [
        v.version,
        v.kind,
        v.pendingCount,
        v.reason,
      ]),
    ).toEqual([
      [1, "SUBMISSION", 5, ""],
      [2, "CONSOLIDATION", 0, ""],
      [3, "CORRECTION", 0, "Registro de águas-vivas lançado depois"],
    ]);
    // The first version still says what was true when it was sent.
    expect(
      (closing.versions[0]!.summary as { presence: { provisional: number } })
        .presence.provisional,
    ).toBe(2);

    // The closing created no record and changed none.
    expect(await db.attendanceRecord.count({ where: { postId } })).toBe(
      recordsBefore.attendance,
    );
    expect(await db.occurrence.count({ where: { postId } })).toBe(
      recordsBefore.occurrences + 1,
    );
    expect(await db.checklist.count({ where: { postId } })).toBe(
      recordsBefore.checklists + 1,
    );

    // Versions cannot be rewritten or deleted.
    await expect(
      db.$executeRaw`UPDATE "DailyClosingVersion" SET "pendingCount" = 0 WHERE "closingId" = ${closing.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "DailyClosing" WHERE "id" = ${closing.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE "DailyClosing" SET "date" = '2000-01-01' WHERE "id" = ${closing.id}::uuid`,
    ).rejects.toThrow(/immutable/);
  });
});
