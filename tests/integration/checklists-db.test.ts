/**
 * Checklists against a real, disposable PostgreSQL with migrations applied:
 * real actions, queries, constraints and triggers.
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

const actions = await import("@/features/checklists/actions");
const queries = await import("@/features/checklists/queries");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe.skipIf(!url)("checklists against PostgreSQL", () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 6);
  const today = operationalToday(new Date());
  let postId: string;
  let journeyAna: string;
  let journeyBia: string;
  const actors = {} as Record<"ana" | "bia" | "coord" | "authority", Actor>;

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

  function as<T>(who: Actor, run: () => Promise<T>) {
    state.actor = who;
    return run();
  }

  async function items() {
    return db.checklistItem.findMany({
      where: { postId },
      include: { versions: { orderBy: { version: "desc" } } },
    });
  }

  async function checklistOf(journeyId: string) {
    return db.checklist.findUniqueOrThrow({
      where: { journeyId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
  }

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
            name: `${name} ${tag}`,
            role,
            passwordHash: "x",
            mustChangePassword: false,
          },
        })
      ).id;
    const ids = {
      ana: await user("ana", "LIFEGUARD"),
      bia: await user("bia", "LIFEGUARD"),
      coord: await user("coord", "COORDINATOR"),
      authority: await user("authority", "AUTHORITY"),
    };
    postId = (
      await db.post.create({
        data: { code: `CK-${tag}`, name: `Checklist ${tag}` },
      })
    ).id;
    await db.postCoordinator.create({ data: { postId, userId: ids.coord } });
    // Two assumptions at the same post on the same day (two people).
    journeyAna = (
      await db.journey.create({
        data: { userId: ids.ana, date: toDbDate(today), postId },
      })
    ).id;
    journeyBia = (
      await db.journey.create({
        data: { userId: ids.bia, date: toDbDate(today), postId },
      })
    ).id;

    actors.ana = actor(ids.ana, "LIFEGUARD", { assignedPostIds: [postId] });
    actors.bia = actor(ids.bia, "LIFEGUARD", { assignedPostIds: [postId] });
    actors.coord = actor(ids.coord, "COORDINATOR", {
      coordinatedPostIds: [postId],
    });
    actors.authority = actor(ids.authority, "AUTHORITY");
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("runs the flow: list, independent checklists, duplicates, corrections, history", async () => {
    // 1. The coordinator builds the list; authority cannot.
    for (const [label, position] of [
      ["Boia", "1"],
      ["Rádio", "2"],
      ["Nadadeira", "3"],
    ] as const) {
      expect(
        await as(actors.coord, () =>
          actions.createItemAction(
            null,
            form({ postId, label, guidance: "", position }),
          ),
        ),
      ).toMatchObject({ ok: true });
    }
    expect(
      await as(actors.authority, () =>
        actions.createItemAction(
          null,
          form({ postId, label: "Apito", guidance: "", position: "4" }),
        ),
      ),
    ).toMatchObject({ ok: false });
    const nadadeira = (await items()).find(
      (item) => item.versions[0]!.label === "Nadadeira",
    )!;
    await as(actors.coord, () =>
      actions.setItemActiveAction(
        null,
        form({ itemId: nadadeira.id, active: "false" }),
      ),
    );

    // 2. Ana starts her checklist (twice: still one), with the active items only.
    for (let i = 0; i < 2; i++) {
      expect(
        await as(actors.ana, () =>
          actions.startChecklistAction(null, form({ journeyId: journeyAna })),
        ),
      ).toMatchObject({ ok: true });
    }
    expect(await db.checklist.count({ where: { journeyId: journeyAna } })).toBe(
      1,
    );
    const ana = await checklistOf(journeyAna);
    expect(ana.lines.map((line) => line.label)).toEqual(["Boia", "Rádio"]);
    // Bia cannot start or fill Ana's checklist.
    expect(
      await as(actors.bia, () =>
        actions.startChecklistAction(null, form({ journeyId: journeyAna })),
      ),
    ).toMatchObject({ ok: false });

    const [boia, radio] = ana.lines;
    const answers = (radioState: "OK" | "DAMAGED", note = "") => [
      { lineId: boia!.id, state: "OK" as const, note: "" },
      { lineId: radio!.id, state: radioState, note },
    ];
    const save = (who: Actor, extra: Record<string, unknown>) =>
      as(who, () =>
        actions.saveChecklistAction({
          checklistId: ana.id,
          requestId: randomUUID(),
          answers: answers("OK"),
          generalNote: "",
          submit: false,
          reason: "",
          ...extra,
        }),
      );

    // 3. A draft sent three times at once (lost connection, retries) is stored once.
    const draftId = randomUUID();
    const repeats = await Promise.all(
      [0, 1, 2].map(() =>
        save(actors.ana, {
          requestId: draftId,
          answers: [{ lineId: boia!.id, state: "OK", note: "" }],
        }),
      ),
    );
    expect(repeats.every((result) => result.ok)).toBe(true);
    expect(
      await db.checklistRevision.count({ where: { checklistId: ana.id } }),
    ).toBe(1);
    expect((await checklistOf(journeyAna)).status).toBe("DRAFT");

    // 4. Incomplete cannot be sent; complete can. Bia and the coordinator cannot save it.
    expect(
      await save(actors.ana, {
        submit: true,
        answers: answers("OK").slice(0, 1),
      }),
    ).toMatchObject({ ok: false });
    expect(await save(actors.bia, { submit: true })).toMatchObject({
      ok: false,
    });
    expect(await save(actors.coord, { submit: true })).toMatchObject({
      ok: false,
    });
    const submitId = randomUUID();
    expect(
      await save(actors.ana, {
        requestId: submitId,
        submit: true,
        answers: answers("DAMAGED", "Sem bateria"),
      }),
    ).toMatchObject({
      ok: true,
      data: { kind: "SUBMISSION", status: "SUBMITTED" },
    });
    // The answer was lost and the phone sends it again: nothing duplicated.
    expect(
      await save(actors.ana, {
        requestId: submitId,
        submit: true,
        answers: answers("DAMAGED", "Sem bateria"),
      }),
    ).toMatchObject({ ok: true, data: { alreadySaved: true } });
    expect(
      await db.checklistRevision.count({ where: { checklistId: ana.id } }),
    ).toBe(2);

    // 5. The coordinator renames "Boia" and adds an item: Ana's checklist does not change.
    const boiaItem = (await items()).find(
      (item) => item.versions[0]!.label === "Boia",
    )!;
    expect(
      await as(actors.coord, () =>
        actions.updateItemAction(
          null,
          form({
            itemId: boiaItem.id,
            label: "Boia circular",
            guidance: "Conferir corda",
            position: "1",
          }),
        ),
      ),
    ).toMatchObject({ ok: true });
    await as(actors.coord, () =>
      actions.createItemAction(
        null,
        form({ postId, label: "Apito", guidance: "", position: "4" }),
      ),
    );
    expect(
      (await items())
        .find((item) => item.id === boiaItem.id)!
        .versions.map((v) => v.version),
    ).toEqual([2, 1]);
    const anaAfter = await checklistOf(journeyAna);
    expect(anaAfter.lines.map((line) => line.label)).toEqual(["Boia", "Rádio"]);

    // 6. Bia's checklist is her own: new list, no answers copied from Ana.
    await as(actors.bia, () =>
      actions.startChecklistAction(null, form({ journeyId: journeyBia })),
    );
    const bia = await checklistOf(journeyBia);
    expect(bia.id).not.toBe(ana.id);
    expect(bia.lines.map((line) => line.label)).toEqual([
      "Boia circular",
      "Rádio",
      "Apito",
    ]);
    expect(bia.currentRevisionId).toBeNull();
    expect(
      await db.checklistRevision.count({ where: { checklistId: bia.id } }),
    ).toBe(0);

    // 7. The coordination finds the problem, with its author.
    const problems = await queries.listMaterialProblems(actors.coord, {
      from: today,
      to: today,
      postId,
    });
    expect(problems).toEqual([
      expect.objectContaining({
        label: "Rádio",
        state: "DAMAGED",
        note: "Sem bateria",
        author: `ana ${tag}`,
      }),
    ]);

    // 8. Correction needs a reason and keeps the previous version.
    expect(await save(actors.ana, { answers: answers("OK") })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/motivo/),
    });
    expect(
      await save(actors.ana, {
        answers: answers("OK", "Bateria trocada"),
        reason: "Rádio recarregado e testado",
      }),
    ).toMatchObject({ ok: true, data: { kind: "CORRECTION" } });
    const revisions = await db.checklistRevision.findMany({
      where: { checklistId: ana.id },
      orderBy: { number: "asc" },
      include: { answers: true },
    });
    expect(revisions.map((r) => [r.number, r.kind, r.reason])).toEqual([
      [1, "DRAFT", ""],
      [2, "SUBMISSION", ""],
      [3, "CORRECTION", "Rádio recarregado e testado"],
    ]);
    expect(
      revisions[1]!.answers.find((a) => a.lineId === radio!.id)?.state,
    ).toBe("DAMAGED");
    expect(
      await queries.listMaterialProblems(actors.coord, {
        from: today,
        to: today,
        postId,
      }),
    ).toEqual([]);

    // 9. Records stay in the post's history after the author leaves.
    await db.user.update({
      where: { id: actors.ana.id },
      data: { active: false },
    });
    const overview = await queries.listChecklistOverview(actors.authority, {
      date: today,
      postId,
    });
    expect(overview?.map((row) => [row.user.name, row.progress])).toEqual([
      [`ana ${tag}`, "SUBMITTED"],
      [`bia ${tag}`, "INCOMPLETE"],
    ]);
    const audit = await db.auditLog.findMany({
      where: { postId, action: { startsWith: "checklist" } },
      select: { action: true, actorId: true },
    });
    expect(
      audit.filter((entry) => entry.action === "checklist.correct"),
    ).toEqual([{ action: "checklist.correct", actorId: actors.ana.id }]);
  });

  it("the database refuses to rewrite or delete what was recorded", async () => {
    const ana = await checklistOf(journeyAna);
    await expect(
      db.$executeRaw`UPDATE "ChecklistAnswer" SET "state" = 'OK' WHERE "lineId" = ${ana.lines[0]!.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "ChecklistRevision" WHERE "checklistId" = ${ana.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE "ChecklistLine" SET "label" = 'x' WHERE "checklistId" = ${ana.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE "ChecklistItemVersion" SET "label" = 'x' WHERE "itemId" IN (SELECT "id" FROM "ChecklistItem" WHERE "postId" = ${postId}::uuid)`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE "Checklist" SET "userId" = ${actors.bia.id}::uuid WHERE "id" = ${ana.id}::uuid`,
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRaw`DELETE FROM "Checklist" WHERE "id" = ${ana.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    // A second checklist for the same assumption is impossible.
    await expect(
      db.checklist.create({
        data: {
          journeyId: journeyAna,
          userId: actors.ana.id,
          postId,
          date: toDbDate(today),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
