import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  availabilityOn,
  isPublished,
  WINDOW_DAYS,
  windowDays,
} from "@/features/schedules/rules";
import type { ScheduleFilters } from "@/features/schedules/schemas";
import { postScope } from "@/features/schedules/scope";
import {
  canManageSchedule,
  canViewPostSchedules,
  type Actor,
} from "@/lib/auth/policy";
import { addDays, fromDbDate, toDbDate } from "@/lib/dates";
import { getDb } from "@/lib/db";

/**
 * Data access for schedules. Lifeguards only see their own entries in
 * published (confirmed or changed) schedules; proposals are never shown to
 * them. Coordinators see their area; authority and administrators see all.
 */

const PUBLISHED: Prisma.EnumScheduleStatusFilter = {
  in: ["CONFIRMED", "CHANGED"],
};

/** Schedule entries matching the filters, within what the actor may see. */
export async function listEntries(actor: Actor, filters: ScheduleFilters) {
  const where: Prisma.ScheduleEntryWhereInput = {
    date: { gte: toDbDate(filters.from), lte: toDbDate(filters.to) },
  };
  if (actor.role === "LIFEGUARD") {
    // Own entries only; the "profissional" filter cannot widen this.
    where.userId = actor.id;
    where.schedule = {
      status: PUBLISHED,
      ...(filters.postId ? { postId: filters.postId } : {}),
    };
  } else {
    const posts = postScope(actor, filters.postId);
    where.schedule = posts ? { postId: posts } : {};
    if (filters.userId) where.userId = filters.userId;
  }

  const entries = await getDb().scheduleEntry.findMany({
    where,
    select: {
      id: true,
      date: true,
      user: { select: { id: true, name: true, active: true } },
      schedule: {
        select: {
          id: true,
          status: true,
          post: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: [
      { date: "asc" },
      { schedule: { post: { name: "asc" } } },
      { user: { name: "asc" } },
    ],
    take: 500,
  });
  return entries.map((entry) => ({ ...entry, date: fromDbDate(entry.date) }));
}

/** Whole schedules touching the period, for coordinators and readers. */
export async function listSchedules(actor: Actor, filters: ScheduleFilters) {
  if (actor.role === "LIFEGUARD") return [];
  const posts = postScope(actor, filters.postId);
  const schedules = await getDb().schedule.findMany({
    where: {
      ...(posts ? { postId: posts } : {}),
      window: {
        startDate: {
          gte: toDbDate(addDays(filters.from, 1 - WINDOW_DAYS)),
          lte: toDbDate(filters.to),
        },
      },
    },
    select: {
      id: true,
      status: true,
      post: { select: { id: true, code: true, name: true } },
      window: { select: { startDate: true } },
      _count: { select: { entries: true } },
    },
    orderBy: [{ window: { startDate: "asc" } }, { post: { name: "asc" } }],
  });
  return schedules.map(({ window, _count, ...schedule }) => ({
    ...schedule,
    startDate: fromDbDate(window.startDate),
    entryCount: _count.entries,
  }));
}

/** Options for "build a schedule": the coordinator's operating posts and open-ended windows. */
export async function getScheduleCreationOptions(actor: Actor, today: string) {
  if (actor.role !== "COORDINATOR" || actor.coordinatedPostIds.length === 0) {
    return null;
  }
  const db = getDb();
  const [posts, windows] = await Promise.all([
    db.post.findMany({
      where: { id: { in: [...actor.coordinatedPostIds] }, status: "OPERATING" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.availabilityWindow.findMany({
      // Windows that still have today or a future day.
      where: { startDate: { gte: toDbDate(addDays(today, 1 - WINDOW_DAYS)) } },
      select: { id: true, startDate: true, status: true },
      orderBy: { startDate: "asc" },
    }),
  ]);
  return {
    posts,
    windows: windows.map((window) => ({
      ...window,
      startDate: fromDbDate(window.startDate),
    })),
  };
}

/**
 * One schedule with its days. Null when it does not exist or the actor may
 * not see whole schedules of its post (lifeguards use listEntries).
 * Coordinators of the post also get the candidates of each day: the post's
 * active team with their declared availability and other commitments.
 */
export async function getScheduleForActor(actor: Actor, scheduleId: string) {
  const db = getDb();
  const schedule = await db.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      status: true,
      postId: true,
      confirmedAt: true,
      confirmedBy: { select: { name: true } },
      post: { select: { id: true, code: true, name: true, status: true } },
      window: { select: { id: true, startDate: true, status: true } },
      entries: {
        select: {
          id: true,
          date: true,
          user: { select: { id: true, name: true, active: true } },
        },
        orderBy: [{ date: "asc" }, { user: { name: "asc" } }],
      },
    },
  });
  if (!schedule || !canViewPostSchedules(actor, schedule.postId)) return null;

  const canManage = canManageSchedule(actor, schedule.postId);
  const startDate = fromDbDate(schedule.window.startDate);
  const days = windowDays(startDate);

  const team = canManage
    ? await db.postAssignment.findMany({
        where: {
          postId: schedule.postId,
          user: { active: true, role: "LIFEGUARD" },
        },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { user: { name: "asc" } },
      })
    : [];

  const userIds = [
    ...new Set([
      ...schedule.entries.map((entry) => entry.user.id),
      ...team.map((member) => member.user.id),
    ]),
  ];
  const [answers, commitments] = await Promise.all([
    db.availability.findMany({
      where: { windowId: schedule.window.id, userId: { in: userIds } },
      select: { userId: true, day1: true, day2: true, day3: true },
    }),
    canManage
      ? db.scheduleEntry.findMany({
          where: {
            userId: { in: userIds },
            date: { in: days.map(toDbDate) },
            scheduleId: { not: schedule.id },
          },
          select: {
            userId: true,
            date: true,
            schedule: { select: { post: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);
  const answerOf = (userId: string) =>
    answers.find((answer) => answer.userId === userId) ?? null;

  return {
    id: schedule.id,
    status: schedule.status,
    published: isPublished(schedule.status),
    confirmedAt: schedule.confirmedAt,
    confirmedBy: schedule.confirmedBy,
    post: schedule.post,
    window: { ...schedule.window, startDate },
    canManage,
    days: days.map((date) => {
      const entries = schedule.entries
        .filter((entry) => fromDbDate(entry.date) === date)
        .map((entry) => ({
          id: entry.id,
          user: entry.user,
          availability: availabilityOn(
            answerOf(entry.user.id),
            startDate,
            date,
          ),
        }));
      const scheduled = new Set(entries.map((entry) => entry.user.id));
      return {
        date,
        entries,
        candidates: team
          .filter((member) => !scheduled.has(member.user.id))
          .map(({ user }) => ({
            ...user,
            availability: availabilityOn(answerOf(user.id), startDate, date),
            busyAt:
              commitments.find(
                (entry) =>
                  entry.userId === user.id && fromDbDate(entry.date) === date,
              )?.schedule.post.name ?? null,
          })),
      };
    }),
  };
}

export async function listScheduleAudit(actor: Actor, scheduleId: string) {
  const schedule = await getDb().schedule.findUnique({
    where: { id: scheduleId },
    select: { postId: true },
  });
  if (!schedule || !canViewPostSchedules(actor, schedule.postId)) return null;
  return getDb().auditLog.findMany({
    where: { entityType: "Schedule", entityId: scheduleId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      createdAt: true,
      action: true,
      before: true,
      after: true,
      reason: true,
      actor: { select: { name: true } },
    },
  });
}
