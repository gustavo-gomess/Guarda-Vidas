import "server-only";

import { ACTIVE_STATUSES, type AlertStatus } from "@/features/alerts/rules";
import { postScope } from "@/features/schedules/scope";
import type { Prisma } from "@/generated/prisma/client";
import {
  canCreateAlert,
  canManageAlerts,
  canViewAlert,
  canViewAvailability,
  type Actor,
} from "@/lib/auth/policy";
import { getDb } from "@/lib/db";

/**
 * Alerts as stored in the database. Coordinators see their area, authority
 * and administrators all, captains the alerts of their posts, authors
 * their own.
 */

function scope(actor: Actor): Prisma.ReinforcementAlertWhereInput | null {
  if (canViewAvailability(actor)) {
    const posts = postScope(actor);
    return posts ? { postId: posts } : {};
  }
  if (actor.role === "LIFEGUARD") {
    return {
      OR: [
        { authorId: actor.id },
        { postId: { in: [...actor.captainPostIds] } },
      ],
    };
  }
  return null;
}

/** For the menu badge: only for those who must act (coordinators). */
export async function countUnacknowledged(actor: Actor): Promise<number> {
  if (actor.role !== "COORDINATOR" || actor.coordinatedPostIds.length === 0) {
    return 0;
  }
  return getDb().reinforcementAlert.count({
    where: { status: "OPEN", postId: { in: [...actor.coordinatedPostIds] } },
  });
}

export type AlertFilters = {
  status?: AlertStatus;
  postId?: string;
  activeOnly: boolean;
};

export async function listAlerts(actor: Actor, filters: AlertFilters) {
  const where = scope(actor);
  if (!where) return null;
  const alerts = await getDb().reinforcementAlert.findMany({
    where: {
      AND: [
        where,
        filters.postId ? { postId: filters.postId } : {},
        filters.status
          ? { status: filters.status }
          : filters.activeOnly
            ? { status: { in: [...ACTIVE_STATUSES] } }
            : {},
      ],
    },
    select: {
      id: true,
      status: true,
      description: true,
      createdAt: true,
      post: { select: { id: true, code: true, name: true } },
      author: { select: { name: true } },
      events: {
        select: {
          createdAt: true,
          toStatus: true,
          actor: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    // Unacknowledged first, then oldest first: the longest waiting on top.
    orderBy: [{ createdAt: "asc" }],
    take: 200,
  });
  const rank = (status: AlertStatus) =>
    status === "OPEN" ? 0 : ACTIVE_STATUSES.includes(status) ? 1 : 2;
  return alerts.sort((a, b) => rank(a.status) - rank(b.status));
}

/** One alert with its full history. Null when not visible. */
export async function getAlertForActor(actor: Actor, alertId: string) {
  const alert = await getDb().reinforcementAlert.findUnique({
    where: { id: alertId },
    select: {
      id: true,
      postId: true,
      authorId: true,
      status: true,
      description: true,
      deviceTime: true,
      createdAt: true,
      post: { select: { code: true, name: true } },
      author: { select: { name: true } },
      events: {
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!alert || !canViewAlert(actor, alert)) return null;
  return {
    ...alert,
    canManage: canManageAlerts(actor, alert.postId),
    isAuthor: alert.authorId === actor.id,
  };
}

/** Posts from which the actor may send alerts (captain). */
export async function listAlertPosts(actor: Actor) {
  const ids = actor.captainPostIds.filter((postId) =>
    canCreateAlert(actor, postId),
  );
  if (ids.length === 0) return [];
  return getDb().post.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
}
