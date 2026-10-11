import "server-only";

import { effectiveTimeOf } from "@/features/attendance/service";
import type { ServerStatus } from "@/features/attendance/states";
import { postScope } from "@/features/schedules/scope";
import type { Prisma } from "@/generated/prisma/client";
import {
  canRegisterAttendance,
  canValidateAttendance,
  canViewAvailability,
  canViewPostSchedules,
  type Actor,
} from "@/lib/auth/policy";
import { addDays, fromDbDate, toDbDate } from "@/lib/dates";
import { getDb } from "@/lib/db";

/**
 * Presence data. Lifeguards see only their own journeys; coordinators the
 * posts of their area; authority and administrators everything, read-only.
 * Coordinates are selected only where a reviewer or the owner needs them.
 */

const PUBLISHED: Prisma.EnumScheduleStatusFilter = {
  in: ["CONFIRMED", "CHANGED"],
};

const primaryRecordFields = {
  id: true,
  kind: true,
  origin: true,
  status: true,
  deviceTime: true,
  receivedAt: true,
  flags: true,
} as const;

type PrimaryRecord = {
  id: string;
  kind: "CHECK_IN" | "CHECK_OUT";
  origin: "ONLINE" | "OFFLINE";
  status: ServerStatus;
  deviceTime: Date;
  receivedAt: Date;
  flags: string[];
};

function primaryView(records: PrimaryRecord[], kind: PrimaryRecord["kind"]) {
  const record = records.find((entry) => entry.kind === kind);
  return record
    ? {
        id: record.id,
        status: record.status,
        origin: record.origin,
        time: effectiveTimeOf(record).toISOString(),
        flags: record.flags,
      }
    : null;
}

/** Everything the lifeguard's presence screen needs, also offline. */
export async function getMyPresence(actor: Actor, today: string) {
  if (!canRegisterAttendance(actor)) return null;
  const db = getDb();
  const [posts, entries, journeys] = await Promise.all([
    db.post.findMany({
      where: { id: { in: [...actor.assignedPostIds] } },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    // A few days ahead, so a page opened offline still knows the schedule.
    db.scheduleEntry.findMany({
      where: {
        userId: actor.id,
        date: {
          gte: toDbDate(addDays(today, -1)),
          lte: toDbDate(addDays(today, 3)),
        },
        schedule: { status: PUBLISHED },
      },
      select: {
        date: true,
        schedule: {
          select: { post: { select: { id: true, code: true, name: true } } },
        },
      },
    }),
    db.journey.findMany({
      where: { userId: actor.id },
      select: {
        id: true,
        date: true,
        post: { select: { id: true, code: true, name: true } },
        records: {
          where: { primaryKind: { not: null } },
          select: primaryRecordFields,
        },
      },
      orderBy: { date: "desc" },
      take: 10,
    }),
  ]);

  return {
    posts,
    schedule: entries.map((entry) => ({
      date: fromDbDate(entry.date),
      post: entry.schedule.post,
    })),
    journeys: journeys.map((journey) => ({
      id: journey.id,
      date: fromDbDate(journey.date),
      post: journey.post,
      checkIn: primaryView(journey.records, "CHECK_IN"),
      checkOut: primaryView(journey.records, "CHECK_OUT"),
    })),
  };
}

export type QueueFilters = { postId?: string; date?: string };

/** Records waiting for a decision, oldest first. Read-only for authority. */
export async function listValidationQueue(actor: Actor, filters: QueueFilters) {
  if (!canViewAvailability(actor)) return null;
  const posts = postScope(actor, filters.postId);
  const records = await getDb().attendanceRecord.findMany({
    where: {
      status: { in: ["AWAITING_VALIDATION", "UNDER_REVIEW"] },
      ...(posts ? { postId: posts } : {}),
      ...(filters.date ? { journey: { date: toDbDate(filters.date) } } : {}),
    },
    select: {
      ...primaryRecordFields,
      journeyId: true,
      postId: true,
      primaryKind: true,
      clockOffsetMs: true,
      locationStatus: true,
      accuracyMeters: true,
      distanceMeters: true,
      user: { select: { name: true } },
      post: { select: { code: true, name: true } },
      journey: { select: { date: true } },
    },
    orderBy: { receivedAt: "asc" },
    take: 200,
  });
  return records.map((record) => ({
    ...record,
    date: fromDbDate(record.journey.date),
    effectiveTime: effectiveTimeOf(record),
    canDecide: canValidateAttendance(actor, record.postId),
  }));
}

/** A journey with every record, decision and history entry. */
export async function getJourneyForActor(actor: Actor, journeyId: string) {
  const db = getDb();
  const journey = await db.journey.findUnique({
    where: { id: journeyId },
    select: {
      id: true,
      date: true,
      userId: true,
      postId: true,
      createdAt: true,
      user: { select: { name: true } },
      post: { select: { code: true, name: true } },
      records: {
        select: {
          ...primaryRecordFields,
          primaryKind: true,
          clockOffsetMs: true,
          locationStatus: true,
          latitude: true,
          longitude: true,
          accuracyMeters: true,
          distanceMeters: true,
          decisions: {
            select: {
              id: true,
              fromStatus: true,
              toStatus: true,
              reason: true,
              createdAt: true,
              decidedBy: { select: { name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { receivedAt: "asc" },
      },
    },
  });
  if (!journey) return null;
  const own = journey.userId === actor.id;
  if (!own && !canViewPostSchedules(actor, journey.postId)) return null;

  const audit = await db.auditLog.findMany({
    where: {
      entityType: "AttendanceRecord",
      entityId: { in: journey.records.map((record) => record.id) },
    },
    orderBy: { createdAt: "desc" },
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

  return {
    ...journey,
    date: fromDbDate(journey.date),
    canDecide: canValidateAttendance(actor, journey.postId),
    records: journey.records.map((record) => ({
      ...record,
      effectiveTime: effectiveTimeOf(record),
    })),
    audit,
  };
}

export type BoardFilters = { date: string; postId?: string };

/**
 * Who was scheduled and who registered presence on a day, separating
 * validated presence from provisional presence.
 */
export async function getPresenceBoard(actor: Actor, filters: BoardFilters) {
  if (!canViewAvailability(actor)) return null;
  const posts = postScope(actor, filters.postId);
  const date = toDbDate(filters.date);
  const db = getDb();
  const [entries, journeys] = await Promise.all([
    db.scheduleEntry.findMany({
      where: {
        date,
        schedule: { status: PUBLISHED, ...(posts ? { postId: posts } : {}) },
      },
      select: {
        user: { select: { id: true, name: true } },
        schedule: {
          select: { post: { select: { id: true, code: true, name: true } } },
        },
      },
    }),
    db.journey.findMany({
      where: { date, ...(posts ? { postId: posts } : {}) },
      select: {
        id: true,
        user: { select: { id: true, name: true } },
        post: { select: { id: true, code: true, name: true } },
        records: {
          where: { primaryKind: { not: null } },
          select: primaryRecordFields,
        },
        _count: { select: { records: true } },
      },
    }),
  ]);

  const rows = new Map<
    string,
    {
      user: { id: string; name: string };
      scheduledPost: { id: string; code: string; name: string } | null;
      journey: {
        id: string;
        post: { id: string; code: string; name: string };
        checkIn: ReturnType<typeof primaryView>;
        checkOut: ReturnType<typeof primaryView>;
        extraRecords: number;
      } | null;
    }
  >();
  for (const entry of entries) {
    rows.set(entry.user.id, {
      user: entry.user,
      scheduledPost: entry.schedule.post,
      journey: null,
    });
  }
  for (const journey of journeys) {
    const row = rows.get(journey.user.id) ?? {
      user: journey.user,
      scheduledPost: null,
      journey: null,
    };
    row.journey = {
      id: journey.id,
      post: journey.post,
      checkIn: primaryView(journey.records, "CHECK_IN"),
      checkOut: primaryView(journey.records, "CHECK_OUT"),
      extraRecords: journey._count.records - journey.records.length,
    };
    rows.set(journey.user.id, row);
  }
  return [...rows.values()].sort((a, b) =>
    a.user.name.localeCompare(b.user.name),
  );
}
