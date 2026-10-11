/**
 * Reinforcement alerts and operational records against a real, disposable
 * PostgreSQL with migrations applied: real service, actions, queries,
 * locks and triggers. Skipped unless TEST_DATABASE_URL is set.
 * NEVER point it at real data.
 */
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { Actor } from "@/lib/auth/policy";

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

const { createAlert } = await import("@/features/alerts/service");
const { transitionAlertAction } = await import("@/features/alerts/actions");
const alertQueries = await import("@/features/alerts/queries");
const occurrenceActions = await import("@/features/occurrences/actions");
const occurrenceQueries = await import("@/features/occurrences/queries");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe.skipIf(!url)("alerts and occurrences against PostgreSQL", () => {
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 6);
  let postId: string;
  const actors = {} as Record<
    "captain" | "lifeguard" | "coord1" | "coord2" | "authority" | "admin",
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

  function as<T>(who: Actor, run: () => Promise<T>) {
    state.actor = who;
    return run();
  }

  const transition = (
    who: Actor,
    alertId: string,
    action: string,
    expectedStatus: string,
    note = "",
  ) =>
    as(who, () =>
      transitionAlertAction(
        null,
        form({ alertId, action, expectedStatus, note, confirmed: "on" }),
      ),
    );

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    state.db = db;
    const user = async (name: string, role: Actor["role"], isAdmin = false) =>
      (
        await db.user.create({
          data: {
            username: `it-${tag}-${name}`,
            name: `${name} ${tag}`,
            role,
            isAdmin,
            passwordHash: "x",
            mustChangePassword: false,
          },
        })
      ).id;
    const ids = {
      captain: await user("captain", "LIFEGUARD"),
      lifeguard: await user("lifeguard", "LIFEGUARD"),
      coord1: await user("coord1", "COORDINATOR"),
      coord2: await user("coord2", "COORDINATOR"),
      authority: await user("authority", "AUTHORITY"),
      admin: await user("admin", "COORDINATOR", true),
    };
    postId = (
      await db.post.create({
        data: { code: `AL-${tag}`, name: `Alertas ${tag}` },
      })
    ).id;
    await db.postCoordinator.createMany({
      data: [ids.coord1, ids.coord2].map((userId) => ({ postId, userId })),
    });
    await db.postAssignment.createMany({
      data: [
        { postId, userId: ids.captain, isCaptain: true },
        { postId, userId: ids.lifeguard },
      ],
    });
    actors.captain = actor(ids.captain, "LIFEGUARD", {
      assignedPostIds: [postId],
      captainPostIds: [postId],
    });
    actors.lifeguard = actor(ids.lifeguard, "LIFEGUARD", {
      assignedPostIds: [postId],
    });
    actors.coord1 = actor(ids.coord1, "COORDINATOR", {
      coordinatedPostIds: [postId],
    });
    actors.coord2 = actor(ids.coord2, "COORDINATOR", {
      coordinatedPostIds: [postId],
    });
    actors.authority = actor(ids.authority, "AUTHORITY");
    actors.admin = actor(ids.admin, "COORDINATOR", { isAdmin: true });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("alert: created by the captain, followed and closed by the coordination", async () => {
    const input = {
      id: randomUUID(),
      postId,
      description: "Mar agitado, preciso de 2 guarda-vidas",
      deviceTime: new Date(),
      allowAnotherActive: false,
    };
    // A lifeguard who is not captain cannot.
    expect(
      await createAlert(db, actors.lifeguard, { ...input, id: randomUUID() }),
    ).toMatchObject({
      ok: false,
      httpStatus: 403,
    });

    // Sent three times at once (lost answers): stored once.
    const sends = await Promise.all(
      [0, 1, 2].map(() => createAlert(db, actors.captain, input)),
    );
    expect(sends.every((result) => result.ok)).toBe(true);
    expect(sends.filter((result) => result.ok && result.created)).toHaveLength(
      1,
    );
    expect(await db.reinforcementAlert.count({ where: { postId } })).toBe(1);

    // A second active alert needs explicit confirmation.
    const second = {
      ...input,
      id: randomUUID(),
      description: "Outra necessidade: maca",
    };
    expect(await createAlert(db, actors.captain, second)).toMatchObject({
      ok: false,
      code: "ACTIVE_ALERT_EXISTS",
      activeAlertId: input.id,
    });

    // The coordination sees it as unacknowledged.
    expect(await alertQueries.countUnacknowledged(actors.coord1)).toBe(1);
    expect(await alertQueries.countUnacknowledged(actors.authority)).toBe(0);

    // Two coordinators acknowledge at the same moment: exactly one wins.
    const acks = await Promise.all([
      transition(actors.coord1, input.id, "ACKNOWLEDGE", "OPEN"),
      transition(actors.coord2, input.id, "ACKNOWLEDGE", "OPEN"),
    ]);
    expect(acks.filter((result) => result.ok)).toHaveLength(1);
    expect(acks.find((result) => !result.ok)).toMatchObject({
      error: expect.stringMatching(/mudou/),
    });
    expect(await alertQueries.countUnacknowledged(actors.coord1)).toBe(0);

    // Authority reads, does not act.
    expect(
      await transition(actors.authority, input.id, "START", "ACKNOWLEDGED"),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await alertQueries.getAlertForActor(actors.authority, input.id),
    ).toMatchObject({
      canManage: false,
    });

    expect(
      await transition(actors.coord1, input.id, "START", "ACKNOWLEDGED"),
    ).toMatchObject({ ok: true });
    expect(
      await transition(actors.coord1, input.id, "CLOSE", "IN_PROGRESS"),
    ).toMatchObject({ ok: false });
    expect(
      await transition(
        actors.coord1,
        input.id,
        "CLOSE",
        "IN_PROGRESS",
        "Dois guarda-vidas do posto 3 enviados",
      ),
    ).toMatchObject({ ok: true });
    // Closed is final.
    expect(
      await transition(
        actors.captain,
        input.id,
        "CANCEL",
        "CLOSED",
        "Tarde demais",
      ),
    ).toMatchObject({
      ok: false,
    });

    const alert = await alertQueries.getAlertForActor(actors.captain, input.id);
    expect(alert?.status).toBe("CLOSED");
    expect(
      alert?.events.map((event) => [event.fromStatus, event.toStatus]),
    ).toEqual([
      [null, "OPEN"],
      ["OPEN", "ACKNOWLEDGED"],
      ["ACKNOWLEDGED", "IN_PROGRESS"],
      ["IN_PROGRESS", "CLOSED"],
    ]);
    expect(alert?.events.at(-1)?.note).toBe(
      "Dois guarda-vidas do posto 3 enviados",
    );

    // The history belongs to the post, with authors.
    const audit = await db.auditLog.findMany({
      where: { postId, entityType: "ReinforcementAlert" },
      select: { action: true },
    });
    expect(audit.map((entry) => entry.action).sort()).toEqual(
      [
        "alert.acknowledge",
        "alert.close",
        "alert.create",
        "alert.start",
      ].sort(),
    );

    // Now a new alert is possible, and the captain can cancel it.
    const third = {
      ...input,
      id: randomUUID(),
      description: "Reforço para o fim da tarde",
    };
    expect(await createAlert(db, actors.captain, third)).toMatchObject({
      ok: true,
      created: true,
    });
    expect(
      await transition(
        actors.captain,
        third.id,
        "CANCEL",
        "OPEN",
        "Situação normalizada",
      ),
    ).toMatchObject({ ok: true });
  });

  it("alert data and events cannot be rewritten or deleted", async () => {
    const alert = await db.reinforcementAlert.findFirstOrThrow({
      where: { postId },
    });
    await expect(
      db.$executeRaw`UPDATE "ReinforcementAlert" SET "description" = 'x' WHERE "id" = ${alert.id}::uuid`,
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRaw`DELETE FROM "ReinforcementAlert" WHERE "id" = ${alert.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "AlertEvent" WHERE "alertId" = ${alert.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it("occurrences: versioned categories, idempotent records, annulment", async () => {
    const fieldsV1 = [
      {
        key: "quantidade",
        label: "Quantidade",
        type: "number",
        required: true,
        options: [],
      },
    ];
    expect(
      await as(actors.coord1, () =>
        occurrenceActions.createCategoryAction(
          null,
          form({
            name: `Águas-vivas ${tag}`,
            description: "",
            fields: JSON.stringify(fieldsV1),
          }),
        ),
      ),
    ).toMatchObject({ ok: false }); // not an administrator
    expect(
      await as(actors.admin, () =>
        occurrenceActions.createCategoryAction(
          null,
          form({
            name: `Águas-vivas ${tag}`,
            description: "",
            fields: JSON.stringify(fieldsV1),
          }),
        ),
      ),
    ).toMatchObject({ ok: true });
    const category = (await occurrenceQueries.listCategories()).find(
      (entry) => entry.current.name === `Águas-vivas ${tag}`,
    )!;

    const record = {
      id: randomUUID(),
      postId,
      categoryId: category.id,
      occurredAt: new Date(Date.now() - 600_000).toISOString(),
      description: "Muitas caravelas no canto sul",
      values: { quantidade: "40" },
    };
    // The coordinator does not register; the lifeguard does, twice at once.
    expect(
      await as(actors.coord1, () =>
        occurrenceActions.createOccurrenceAction(record),
      ),
    ).toMatchObject({
      ok: false,
    });
    state.actor = actors.lifeguard;
    const saves = await Promise.all([
      occurrenceActions.createOccurrenceAction(record),
      occurrenceActions.createOccurrenceAction(record),
    ]);
    expect(saves.every((result) => result.ok)).toBe(true);
    expect(await db.occurrence.count({ where: { postId } })).toBe(1);

    // The category changes: the old record keeps its fields.
    const fieldsV2 = [
      {
        key: "quantidade",
        label: "Quantidade aproximada",
        type: "number",
        required: true,
        options: [],
      },
      {
        key: "especie",
        label: "Espécie",
        type: "choice",
        required: true,
        options: ["Caravela", "Água-viva"],
      },
    ];
    await as(actors.admin, () =>
      occurrenceActions.updateCategoryAction(
        null,
        form({
          categoryId: category.id,
          name: `Águas-vivas ${tag}`,
          description: "",
          active: "true",
          fields: JSON.stringify(fieldsV2),
        }),
      ),
    );
    const old = await as(actors.authority, () =>
      occurrenceQueries.getOccurrenceForActor(actors.authority, record.id),
    );
    expect(old?.categoryVersion.version).toBe(1);
    expect(old?.categoryVersion.fields.map((field) => field.label)).toEqual([
      "Quantidade",
    ]);
    expect(old?.values).toEqual({ quantidade: 40 });
    // New records use the new version.
    expect(
      await as(actors.lifeguard, () =>
        occurrenceActions.createOccurrenceAction({
          ...record,
          id: randomUUID(),
          values: { quantidade: "3" },
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { especie: [expect.any(String)] },
    });

    // Annulment keeps the record and its author.
    expect(
      await as(actors.captain, () =>
        occurrenceActions.annulOccurrenceAction(
          null,
          form({ occurrenceId: record.id, reason: "Não fui eu" }),
        ),
      ),
    ).toMatchObject({ ok: false }); // not author nor coordinator
    expect(
      await as(actors.coord1, () =>
        occurrenceActions.annulOccurrenceAction(
          null,
          form({
            occurrenceId: record.id,
            reason: "Registrado no posto errado",
          }),
        ),
      ),
    ).toMatchObject({ ok: true });
    const listed = await occurrenceQueries.listOccurrences(actors.coord1, {
      from: "2020-01-01",
      to: "2100-01-01",
      postId,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        id: record.id,
        author: { name: `lifeguard ${tag}` },
        annulment: { reason: "Registrado no posto errado" },
      }),
    ]);

    await expect(
      db.$executeRaw`UPDATE "Occurrence" SET "description" = 'x' WHERE "id" = ${record.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "OccurrenceAnnulment" WHERE "occurrenceId" = ${record.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE "OccurrenceCategoryVersion" SET "name" = 'x' WHERE "categoryId" = ${category.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });
});
