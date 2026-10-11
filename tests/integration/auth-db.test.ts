/**
 * Integration tests against a real, disposable PostgreSQL with migrations
 * applied. Skipped unless TEST_DATABASE_URL is set. NEVER point it at a
 * database with real data: the tests create and delete rows.
 *
 *   TEST_DATABASE_URL=postgresql://... npm run test:run
 */
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import {
  authenticate,
  startSession,
  validateSession,
} from "@/lib/auth/auth-service";
import { hashPassword } from "@/lib/auth/password";
import { createPrismaAuthStore } from "@/lib/auth/prisma-auth-store";

// eslint-disable-next-line no-restricted-properties -- test-only connection
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("auth against PostgreSQL", () => {
  let db: PrismaClient;
  const username = `it-${randomUUID().slice(0, 8)}`;
  const password = "integracao-senha-1";
  let userId: string;

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    const user = await db.user.create({
      data: {
        username,
        name: "Integração",
        role: "LIFEGUARD",
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Users with audit history cannot be deleted (Restrict); deactivate instead.
    await db?.session.deleteMany({ where: { userId } });
    await db?.$disconnect();
  });

  it("signs in, keeps a session and ends it when the user is deactivated", async () => {
    const store = createPrismaAuthStore(db);
    const now = new Date();

    const result = await authenticate(store, { username, password }, now);
    expect(result).toMatchObject({ ok: true, userId });

    const { token } = await startSession(store, userId, now);
    const row = await db.session.findFirstOrThrow({ where: { userId } });
    expect(row.id).not.toBe(token); // only the hash is stored

    expect(await validateSession(store, token, now)).toMatchObject({ userId });

    await db.user.update({ where: { id: userId }, data: { active: false } });
    expect(await validateSession(store, token, now)).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(
      await authenticate(store, { username, password }, now),
    ).toMatchObject({ ok: false, reason: "inactive" });
  });

  it("enforces unique usernames in the database", async () => {
    await expect(
      db.user.create({
        data: {
          username,
          name: "Duplicado",
          role: "LIFEGUARD",
          passwordHash: "x",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps the audit log append-only, even for direct SQL", async () => {
    const entry = await db.$transaction(async (tx) => {
      await recordAudit(tx, {
        actorId: null,
        action: "test.integration",
        entityType: "User",
        entityId: userId,
        after: { passwordHash: "must-not-be-stored", active: false },
      });
      return tx.auditLog.findFirstOrThrow({
        where: { action: "test.integration", entityId: userId },
      });
    });
    expect(entry.after).toEqual({ active: false });

    await expect(
      db.$executeRaw`UPDATE "AuditLog" SET "action" = 'changed' WHERE "id" = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`TRUNCATE "AuditLog"`).rejects.toThrow(
      /append-only/,
    );
  });
});
