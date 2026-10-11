import { createHash } from "node:crypto";

import {
  classifyTiming,
  planRegistration,
  postFor,
  type RegistrationInput,
} from "@/features/attendance/rules";
import type {
  AttendanceOrigin,
  ServerStatus,
} from "@/features/attendance/states";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/policy";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { isUniqueConstraintError } from "@/lib/errors";

/**
 * Stores entries and exits. Idempotent by record id: sending the same
 * record again (lost answer, repeated sync) returns the stored one and
 * creates nothing. Shared by the online request and the offline queue.
 */

export type RecordSummary = {
  id: string;
  kind: "CHECK_IN" | "CHECK_OUT";
  origin: AttendanceOrigin;
  status: ServerStatus;
  effectiveTime: string;
  receivedAt: string;
  flags: string[];
};

export type RegistrationResult =
  | { ok: true; created: boolean; record: RecordSummary }
  | { ok: false; httpStatus: number; code: string; message: string };

/** Official time for online records, declared time for offline ones. */
export function effectiveTimeOf(record: {
  origin: AttendanceOrigin;
  deviceTime: Date;
  receivedAt: Date;
}): Date {
  return record.origin === "ONLINE" ? record.receivedAt : record.deviceTime;
}

/** Hash of what was registered; the online/offline mode is not part of it. */
export function hashPayload(input: RegistrationInput): string {
  const canonical = JSON.stringify([
    input.userId,
    input.kind,
    input.deviceTime.toISOString(),
    input.clockOffsetMs,
    input.postId,
    input.location.status,
    input.location.latitude ?? null,
    input.location.longitude ?? null,
    input.location.accuracyMeters ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

const summaryFields = {
  id: true,
  kind: true,
  origin: true,
  status: true,
  deviceTime: true,
  receivedAt: true,
  flags: true,
} as const;

function summarize(record: {
  id: string;
  kind: "CHECK_IN" | "CHECK_OUT";
  origin: AttendanceOrigin;
  status: ServerStatus;
  deviceTime: Date;
  receivedAt: Date;
  flags: string[];
}): RecordSummary {
  return {
    id: record.id,
    kind: record.kind,
    origin: record.origin,
    status: record.status,
    effectiveTime: effectiveTimeOf(record).toISOString(),
    receivedAt: record.receivedAt.toISOString(),
    flags: record.flags,
  };
}

async function attempt(
  db: PrismaClient,
  actor: Actor,
  input: RegistrationInput,
  now: Date,
): Promise<RegistrationResult> {
  const payloadHash = hashPayload(input);
  return db.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({
      where: { id: input.id },
      select: { ...summaryFields, userId: true, payloadHash: true },
    });
    const timing = classifyTiming({
      mode: input.mode,
      deviceTime: input.deviceTime,
      clockOffsetMs: input.clockOffsetMs,
      now,
    });
    const date = toDbDate(timing.date);

    const journey = await tx.journey.findUnique({
      where: { userId_date: { userId: actor.id, date } },
      select: {
        id: true,
        postId: true,
        records: {
          where: { primaryKind: { not: null } },
          select: {
            kind: true,
            status: true,
            origin: true,
            deviceTime: true,
            receivedAt: true,
          },
        },
      },
    });
    const scheduled = await tx.scheduleEntry.findUnique({
      where: { userId_date: { userId: actor.id, date } },
      select: { schedule: { select: { postId: true, status: true } } },
    });
    // Only published schedules count; a proposal is not a schedule yet.
    const scheduledPostId =
      scheduled && scheduled.schedule.status !== "PROPOSED"
        ? scheduled.schedule.postId
        : null;
    const postId = postFor(input, scheduledPostId, journey?.postId ?? null);
    const post = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        status: true,
        latitude: true,
        longitude: true,
        proximityRadiusMeters: true,
      },
    });

    const primary = (kind: "CHECK_IN" | "CHECK_OUT") =>
      journey?.records.find((record) => record.kind === kind) ?? null;
    const checkIn = primary("CHECK_IN");
    const checkOut = primary("CHECK_OUT");

    const plan = planRegistration(input, {
      actor,
      now,
      payloadHash,
      existing,
      timing,
      scheduledPostId,
      post,
      journey: journey && {
        id: journey.id,
        postId: journey.postId,
        checkIn: checkIn && {
          status: checkIn.status,
          effectiveTime: effectiveTimeOf(checkIn),
        },
        checkOut: checkOut && { effectiveTime: effectiveTimeOf(checkOut) },
      },
    });

    if (plan.type === "error") {
      return {
        ok: false,
        httpStatus: plan.httpStatus,
        code: plan.code,
        message: plan.message,
      };
    }
    if (plan.type === "already-stored") {
      return { ok: true, created: false, record: summarize(existing!) };
    }

    const journeyId =
      plan.journeyId ??
      (
        await tx.journey.create({
          data: { userId: actor.id, date, postId: plan.postId },
          select: { id: true },
        })
      ).id;

    const location = input.location;
    const record = await tx.attendanceRecord.create({
      data: {
        id: input.id,
        journeyId,
        userId: actor.id,
        postId: plan.postId,
        kind: input.kind,
        primaryKind: plan.primary ? input.kind : null,
        origin: plan.origin,
        deviceTime: input.deviceTime,
        clockOffsetMs: input.clockOffsetMs,
        receivedAt: now,
        locationStatus: location.status,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        accuracyMeters: location.accuracyMeters ?? null,
        distanceMeters: plan.distanceMeters,
        flags: plan.flags,
        payloadHash,
        status: plan.status,
      },
      select: summaryFields,
    });
    await tx.attendanceDecision.create({
      data: {
        recordId: record.id,
        decidedById: null,
        fromStatus: null,
        toStatus: plan.status,
        reason: "Recebido pelo servidor",
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "attendance.sync",
      entityType: "AttendanceRecord",
      entityId: record.id,
      postId: plan.postId,
      // No coordinates in the audit trail; they stay on the record.
      after: {
        kind: input.kind,
        origin: plan.origin,
        date: fromDbDate(date),
        deviceTime: input.deviceTime.toISOString(),
        receivedAt: now.toISOString(),
        status: plan.status,
        flags: plan.flags.join(", "),
      },
    });
    return { ok: true, created: true, record: summarize(record) };
  });
}

export async function registerAttendance(
  db: PrismaClient,
  actor: Actor,
  input: RegistrationInput,
  now: Date = new Date(),
): Promise<RegistrationResult> {
  try {
    return await attempt(db, actor, input, now);
  } catch (error) {
    // Two requests at the same moment (same record twice, or two entries
    // creating the same journey): the second one sees the first on retry.
    if (!isUniqueConstraintError(error)) throw error;
    return attempt(db, actor, input, now);
  }
}
