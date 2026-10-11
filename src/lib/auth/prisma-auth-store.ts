import type { AuthStore } from "@/lib/auth/auth-service";
import type { PrismaClient } from "@/generated/prisma/client";

/** AuthStore backed by Prisma. Kept free of "server-only" for integration tests. */
export function createPrismaAuthStore(db: PrismaClient): AuthStore {
  return {
    async findUserForLogin(username) {
      return db.user.findUnique({
        where: { username },
        select: {
          id: true,
          active: true,
          passwordHash: true,
          failedLoginAttempts: true,
          lockedUntil: true,
          mustChangePassword: true,
        },
      });
    },

    async recordFailedLogin(userId, failedLoginAttempts, lockedUntil) {
      await db.user.update({
        where: { id: userId },
        data: { failedLoginAttempts, lockedUntil },
      });
    },

    async recordSuccessfulLogin(userId, newPasswordHash) {
      await db.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
        },
      });
    },

    async createSession(session) {
      await db.session.create({ data: session });
    },

    async findSession(id) {
      const session = await db.session.findUnique({
        where: { id },
        include: { user: { select: { active: true } } },
      });
      if (!session) return null;
      return {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        userActive: session.user.active,
      };
    },

    async extendSession(id, expiresAt) {
      await db.session.updateMany({ where: { id }, data: { expiresAt } });
    },

    async deleteSession(id) {
      await db.session.deleteMany({ where: { id } });
    },

    async deleteUserSessions(userId, exceptSessionId) {
      await db.session.deleteMany({
        where: {
          userId,
          ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        },
      });
    },
  };
}
