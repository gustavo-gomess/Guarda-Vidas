import "server-only";

import { canManageUsers, canViewUser, type Actor } from "@/lib/auth/policy";
import { getDb } from "@/lib/db";

/**
 * Data access for users. Every function takes the Actor and checks the
 * policy itself, so callers cannot fetch data they are not allowed to see.
 * Password hashes and login counters are never selected.
 */

const publicUserFields = {
  id: true,
  username: true,
  name: true,
  role: true,
  isAdmin: true,
  active: true,
  mustChangePassword: true,
  createdAt: true,
} as const;

export async function listUsersForAdmin(actor: Actor) {
  if (!canManageUsers(actor)) return null;
  return getDb().user.findMany({
    select: publicUserFields,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** Null when the user does not exist or the actor may not see them. */
export async function getUserForActor(actor: Actor, userId: string) {
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: {
      ...publicUserFields,
      lockedUntil: true,
      coordinatedPosts: {
        select: { post: { select: { id: true, name: true } } },
      },
      assignments: {
        select: { isCaptain: true, post: { select: { id: true, name: true } } },
      },
    },
  });
  if (!user) return null;

  const target = {
    id: user.id,
    role: user.role,
    assignedPostIds: user.assignments.map((entry) => entry.post.id),
  };
  if (!canViewUser(actor, target)) return null;
  return user;
}

export async function listUserAuditForAdmin(actor: Actor, userId: string) {
  if (!canManageUsers(actor)) return null;
  return getDb().auditLog.findMany({
    where: { entityId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      action: true,
      before: true,
      after: true,
      actor: { select: { name: true } },
      post: { select: { name: true } },
    },
  });
}
