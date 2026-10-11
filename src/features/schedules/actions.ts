"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Prisma } from "@/generated/prisma/client";
import {
  availabilityOn,
  checkAddEntry,
  checkConfirm,
  checkRemoveEntry,
  statusAfterChange,
  windowEnd,
} from "@/features/schedules/rules";
import {
  addEntrySchema,
  confirmScheduleSchema,
  createScheduleSchema,
  removeEntrySchema,
} from "@/features/schedules/schemas";
import { recordAudit } from "@/lib/audit";
import { canManageSchedule, type Actor } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { fromDbDate, operationalToday, toDbDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import {
  fail,
  invalidInput,
  isUniqueConstraintError,
  ok,
  type ActionResult,
} from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Schedule changes. Every action:
 * 1. reads the signed-in Actor;
 * 2. loads the schedule from the database and authorizes against ITS post
 *    (never a post id sent by the browser);
 * 3. locks the schedule row, re-reads its state and applies the rules, so
 *    a confirmation and a change cannot interleave;
 * 4. writes the change and its history in one transaction.
 *
 * Nothing here publishes a schedule except confirmScheduleAction, which is
 * always an explicit act of the coordinator. Automatic suggestion is not
 * implemented (not approved, OD-24).
 */

const FORBIDDEN = "Você não tem permissão para esta operação.";
const NOT_FOUND = "Escala não encontrada.";
const CONFLICT =
  "Conflito: este guarda-vidas acabou de ser escalado neste dia em outra escala. Atualize a página.";

function denied(actor: Actor, action: string, postId?: string) {
  logger.warn("authz.denied", { actorId: actor.id, action, postId });
  return fail(FORBIDDEN);
}

function refresh(scheduleId?: string) {
  revalidatePath("/escalas");
  if (scheduleId) revalidatePath(`/escalas/${scheduleId}`);
}

async function lockSchedule(tx: Prisma.TransactionClient, scheduleId: string) {
  await tx.$executeRaw`SELECT 1 FROM "Schedule" WHERE "id" = ${scheduleId}::uuid FOR UPDATE`;
}

/** Post of a schedule, for authorization. Null when it does not exist. */
async function schedulePost(scheduleId: string) {
  return getDb().schedule.findUnique({
    where: { id: scheduleId },
    select: { postId: true },
  });
}

/**
 * Opens the proposal of a post for a window (or the existing one) and goes
 * to its page. A new schedule starts as PROPOSED and empty.
 */
export async function createScheduleAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = createScheduleSchema.safeParse({
    postId: formData.get("postId"),
    windowId: formData.get("windowId"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { postId, windowId } = parsed.data;

  if (!canManageSchedule(actor, postId)) {
    return denied(actor, "schedule.create", postId);
  }

  const db = getDb();
  const [post, window, existing] = await Promise.all([
    db.post.findUnique({ where: { id: postId }, select: { status: true } }),
    db.availabilityWindow.findUnique({
      where: { id: windowId },
      select: { startDate: true },
    }),
    db.schedule.findUnique({
      where: { postId_windowId: { postId, windowId } },
      select: { id: true },
    }),
  ]);
  if (existing) redirect(`/escalas/${existing.id}`);
  if (!post || post.status !== "OPERATING") {
    return fail("O posto não está em operação; não é possível montar escala.");
  }
  if (!window) return fail("Janela não encontrada.");
  const startDate = fromDbDate(window.startDate);
  if (windowEnd(startDate) < operationalToday(new Date())) {
    return fail("Esta janela já terminou.");
  }

  let scheduleId: string;
  try {
    scheduleId = await db.$transaction(async (tx) => {
      const schedule = await tx.schedule.create({
        data: { postId, windowId },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "schedule.create",
        entityType: "Schedule",
        entityId: schedule.id,
        postId,
        after: { startDate, status: "PROPOSED" },
      });
      return schedule.id;
    });
  } catch (error) {
    // Another coordinator created it meanwhile: open that one.
    if (!isUniqueConstraintError(error)) throw error;
    const created = await db.schedule.findUniqueOrThrow({
      where: { postId_windowId: { postId, windowId } },
      select: { id: true },
    });
    scheduleId = created.id;
  }

  refresh();
  redirect(`/escalas/${scheduleId}`);
}

export async function addEntryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = addEntrySchema.safeParse({
    scheduleId: formData.get("scheduleId"),
    userId: formData.get("userId"),
    date: formData.get("date"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { scheduleId, userId, date, reason } = parsed.data;

  const owner = await schedulePost(scheduleId);
  if (!owner) return fail(NOT_FOUND);
  if (!canManageSchedule(actor, owner.postId)) {
    return denied(actor, "schedule.entry_add", owner.postId);
  }
  const today = operationalToday(new Date());

  try {
    const result = await getDb().$transaction(async (tx) => {
      await lockSchedule(tx, scheduleId);
      const schedule = await tx.schedule.findUniqueOrThrow({
        where: { id: scheduleId },
        select: {
          status: true,
          postId: true,
          windowId: true,
          window: { select: { startDate: true } },
          post: { select: { status: true } },
        },
      });
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          role: true,
          active: true,
          assignments: {
            where: { postId: schedule.postId },
            select: { postId: true },
          },
        },
      });
      const existing = await tx.scheduleEntry.findUnique({
        where: { userId_date: { userId, date: toDbDate(date) } },
        select: {
          schedule: {
            select: { postId: true, post: { select: { name: true } } },
          },
        },
      });
      const answer = await tx.availability.findUnique({
        where: { windowId_userId: { windowId: schedule.windowId, userId } },
        select: { day1: true, day2: true, day3: true },
      });

      const windowStart = fromDbDate(schedule.window.startDate);
      const availability = availabilityOn(answer, windowStart, date);
      const error = checkAddEntry({
        scheduleStatus: schedule.status,
        windowStart,
        postStatus: schedule.post.status,
        date,
        today,
        target: target && {
          role: target.role,
          active: target.active,
          inTeam: target.assignments.length > 0,
        },
        existing: existing && {
          postName: existing.schedule.post.name,
          samePost: existing.schedule.postId === schedule.postId,
        },
        availability,
        reason,
      });
      if (error) return fail(error);

      await tx.scheduleEntry.create({
        data: {
          scheduleId,
          userId,
          date: toDbDate(date),
          createdById: actor.id,
        },
      });
      const status = statusAfterChange(schedule.status);
      if (status !== schedule.status) {
        await tx.schedule.update({
          where: { id: scheduleId },
          data: { status },
        });
      }
      await recordAudit(tx, {
        actorId: actor.id,
        action: "schedule.entry_add",
        entityType: "Schedule",
        entityId: scheduleId,
        postId: schedule.postId,
        before: status !== schedule.status ? { status: schedule.status } : null,
        after: {
          guardaVidas: target?.name,
          userId,
          date,
          availability,
          ...(status !== schedule.status ? { status } : {}),
        },
        reason,
      });
      return ok();
    });
    if (result.ok) refresh(scheduleId);
    return result;
  } catch (error) {
    // The database refuses a second entry for the same person and day.
    if (isUniqueConstraintError(error)) return fail(CONFLICT);
    throw error;
  }
}

export async function removeEntryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = removeEntrySchema.safeParse({
    entryId: formData.get("entryId"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { entryId, reason } = parsed.data;

  const db = getDb();
  const entry = await db.scheduleEntry.findUnique({
    where: { id: entryId },
    select: { scheduleId: true, schedule: { select: { postId: true } } },
  });
  if (!entry) return fail("Este registro já não está na escala.");
  if (!canManageSchedule(actor, entry.schedule.postId)) {
    return denied(actor, "schedule.entry_remove", entry.schedule.postId);
  }
  const { scheduleId } = entry;
  const today = operationalToday(new Date());

  const result = await db.$transaction(async (tx) => {
    await lockSchedule(tx, scheduleId);
    const current = await tx.scheduleEntry.findUnique({
      where: { id: entryId },
      select: {
        userId: true,
        date: true,
        user: { select: { name: true } },
        schedule: { select: { status: true, postId: true } },
      },
    });
    if (!current) return fail("Este registro já não está na escala.");
    const date = fromDbDate(current.date);
    const { status: before, postId } = current.schedule;

    const error = checkRemoveEntry({
      scheduleStatus: before,
      date,
      today,
      reason,
    });
    if (error) return fail(error);

    await tx.scheduleEntry.delete({ where: { id: entryId } });
    const status = statusAfterChange(before);
    if (status !== before) {
      await tx.schedule.update({ where: { id: scheduleId }, data: { status } });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: "schedule.entry_remove",
      entityType: "Schedule",
      entityId: scheduleId,
      postId,
      before: {
        guardaVidas: current.user.name,
        userId: current.userId,
        date,
        ...(status !== before ? { status: before } : {}),
      },
      after: status !== before ? { status } : null,
      reason,
    });
    return ok();
  });

  if (result.ok) refresh(scheduleId);
  return result;
}

/** Publishes a proposal. Only an explicit coordinator action does this. */
export async function confirmScheduleAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = confirmScheduleSchema.safeParse({
    scheduleId: formData.get("scheduleId"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { scheduleId } = parsed.data;

  const owner = await schedulePost(scheduleId);
  if (!owner) return fail(NOT_FOUND);
  if (!canManageSchedule(actor, owner.postId)) {
    return denied(actor, "schedule.confirm", owner.postId);
  }

  const result = await getDb().$transaction(async (tx) => {
    await lockSchedule(tx, scheduleId);
    const schedule = await tx.schedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: {
        status: true,
        postId: true,
        _count: { select: { entries: true } },
      },
    });
    const error = checkConfirm({
      status: schedule.status,
      entryCount: schedule._count.entries,
    });
    if (error) return fail(error);

    await tx.schedule.update({
      where: { id: scheduleId },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedById: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "schedule.confirm",
      entityType: "Schedule",
      entityId: scheduleId,
      postId: schedule.postId,
      before: { status: schedule.status },
      after: { status: "CONFIRMED", entries: schedule._count.entries },
    });
    return ok();
  });

  if (result.ok) refresh(scheduleId);
  return result;
}
