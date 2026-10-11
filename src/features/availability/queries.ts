import "server-only";

import { lifeguardScope, managedPostIds } from "@/features/schedules/scope";
import {
  canSubmitAvailability,
  canViewAvailability,
  type Actor,
} from "@/lib/auth/policy";
import { fromDbDate } from "@/lib/dates";
import { getDb } from "@/lib/db";

/**
 * Data access for availability. Lifeguards only ever read their own
 * answers; coordinators read the teams of their posts; authority reads all.
 */

const windowFields = {
  id: true,
  startDate: true,
  status: true,
  createdBy: { select: { name: true } },
} as const;

/** Recent windows, newest first. Lifeguards also get their own answer. */
export async function listWindows(actor: Actor) {
  const ownAnswer = canSubmitAvailability(actor);
  const windows = await getDb().availabilityWindow.findMany({
    select: {
      ...windowFields,
      availabilities: ownAnswer
        ? {
            where: { userId: actor.id },
            select: {
              day1: true,
              day2: true,
              day3: true,
              note: true,
              submittedAt: true,
              updatedAt: true,
            },
          }
        : false,
    },
    orderBy: { startDate: "desc" },
    take: 30,
  });
  return windows.map(({ availabilities, startDate, ...window }) => ({
    ...window,
    startDate: fromDbDate(startDate),
    mine: availabilities?.[0] ?? null,
  }));
}

export type AvailabilityFilters = { postId?: string; userId?: string };

/**
 * Availability of the lifeguards in the actor's scope for one window.
 * Null when the actor may not see availability or the window does not exist.
 */
export async function getAvailabilityBoard(
  actor: Actor,
  windowId: string,
  filters: AvailabilityFilters,
) {
  if (!canViewAvailability(actor)) return null;
  const db = getDb();
  const window = await db.availabilityWindow.findUnique({
    where: { id: windowId },
    select: windowFields,
  });
  if (!window) return null;

  const visiblePosts = managedPostIds(actor);
  const users = await db.user.findMany({
    where: {
      ...lifeguardScope(actor, filters.postId),
      active: true,
      ...(filters.userId ? { id: filters.userId } : {}),
    },
    select: {
      id: true,
      name: true,
      assignments: {
        where: visiblePosts ? { postId: { in: [...visiblePosts] } } : {},
        select: { post: { select: { id: true, code: true, name: true } } },
      },
      availabilities: {
        where: { windowId },
        select: {
          day1: true,
          day2: true,
          day3: true,
          note: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return {
    window: { ...window, startDate: fromDbDate(window.startDate) },
    rows: users.map((user) => ({
      id: user.id,
      name: user.name,
      posts: user.assignments.map((entry) => entry.post),
      answer: user.availabilities[0] ?? null,
    })),
  };
}

/** People the actor may filter by: lifeguards in their scope. */
export async function listLifeguardsInScope(actor: Actor) {
  if (!canViewAvailability(actor)) return [];
  return getDb().user.findMany({
    where: { ...lifeguardScope(actor), active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
