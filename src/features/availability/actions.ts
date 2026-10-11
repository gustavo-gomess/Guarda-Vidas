"use server";

import { revalidatePath } from "next/cache";

import {
  openWindowSchema,
  setWindowStatusSchema,
  submitAvailabilitySchema,
} from "@/features/availability/schemas";
import {
  checkOpenWindow,
  checkSubmitAvailability,
  WINDOW_DAYS,
} from "@/features/schedules/rules";
import { recordAudit } from "@/lib/audit";
import {
  canManageAvailabilityWindows,
  canSubmitAvailability,
  type Actor,
} from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { addDays, fromDbDate, operationalToday, toDbDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import {
  fail,
  invalidInput,
  isUniqueConstraintError,
  ok,
  type ActionResult,
} from "@/lib/errors";
import { logger } from "@/lib/logger";

const FORBIDDEN = "Você não tem permissão para esta operação.";
const OVERLAP = "Já existe uma janela que cobre algum desses dias.";

function denied(actor: Actor, action: string) {
  logger.warn("authz.denied", { actorId: actor.id, action });
  return fail(FORBIDDEN);
}

/** Postgres serialization failure, reported by Prisma as P2034. */
function isSerializationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

function refresh(windowId?: string) {
  revalidatePath("/disponibilidade");
  revalidatePath("/escalas");
  if (windowId) revalidatePath(`/disponibilidade/${windowId}`);
}

// --- Windows (coordinators) ------------------------------------------------

export async function openWindowAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManageAvailabilityWindows(actor)) {
    return denied(actor, "availability_window.open");
  }

  const parsed = openWindowSchema.safeParse({
    startDate: formData.get("startDate"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { startDate } = parsed.data;
  const today = operationalToday(new Date());

  try {
    // Serializable: two overlapping windows opened at the same moment make
    // one of the transactions fail instead of both being saved.
    const result = await getDb().$transaction(
      async (tx) => {
        const nearby = await tx.availabilityWindow.findMany({
          where: {
            startDate: {
              gte: toDbDate(addDays(startDate, 1 - WINDOW_DAYS)),
              lte: toDbDate(addDays(startDate, WINDOW_DAYS - 1)),
            },
          },
          select: { startDate: true },
        });
        const error = checkOpenWindow({
          startDate,
          today,
          existingStartDates: nearby.map((window) =>
            fromDbDate(window.startDate),
          ),
        });
        if (error) return fail(error);

        const window = await tx.availabilityWindow.create({
          data: { startDate: toDbDate(startDate), createdById: actor.id },
        });
        await recordAudit(tx, {
          actorId: actor.id,
          action: "availability_window.open",
          entityType: "AvailabilityWindow",
          entityId: window.id,
          after: { startDate, status: "OPEN" },
        });
        return ok();
      },
      { isolationLevel: "Serializable" },
    );
    if (result.ok) refresh();
    return result;
  } catch (error) {
    if (isUniqueConstraintError(error) || isSerializationError(error)) {
      return fail(OVERLAP);
    }
    throw error;
  }
}

/** Closes a window to new availability, or reopens it. */
export async function setWindowStatusAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManageAvailabilityWindows(actor)) {
    return denied(actor, "availability_window.status");
  }

  const parsed = setWindowStatusSchema.safeParse({
    windowId: formData.get("windowId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { windowId, status } = parsed.data;

  const db = getDb();
  const window = await db.availabilityWindow.findUnique({
    where: { id: windowId },
    select: { status: true },
  });
  if (!window) return fail("Janela não encontrada.");
  if (window.status === status) return ok();

  await db.$transaction(async (tx) => {
    await tx.availabilityWindow.update({
      where: { id: windowId },
      data: { status },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action:
        status === "CLOSED"
          ? "availability_window.close"
          : "availability_window.reopen",
      entityType: "AvailabilityWindow",
      entityId: windowId,
      before: { status: window.status },
      after: { status },
    });
  });

  refresh(windowId);
  return ok();
}

// --- Availability (lifeguards, for themselves) -----------------------------

export async function submitAvailabilityAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canSubmitAvailability(actor)) {
    return denied(actor, "availability.submit");
  }

  const parsed = submitAvailabilitySchema.safeParse({
    windowId: formData.get("windowId"),
    day1: formData.get("day1"),
    day2: formData.get("day2"),
    day3: formData.get("day3"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { windowId, ...answer } = parsed.data;
  // The person is always the signed-in user; any userId in the form is ignored.
  const userId = actor.id;

  const result = await getDb().$transaction(async (tx) => {
    const window = await tx.availabilityWindow.findUnique({
      where: { id: windowId },
      select: { status: true, startDate: true },
    });
    if (!window) return fail("Janela não encontrada.");
    const closed = checkSubmitAvailability(window.status);
    if (closed) return fail(closed);

    const previous = await tx.availability.findUnique({
      where: { windowId_userId: { windowId, userId } },
      select: { day1: true, day2: true, day3: true, note: true },
    });
    await tx.availability.upsert({
      where: { windowId_userId: { windowId, userId } },
      create: { windowId, userId, ...answer },
      update: answer,
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: previous ? "availability.update" : "availability.submit",
      entityType: "Availability",
      entityId: userId,
      before: previous,
      after: { startDate: fromDbDate(window.startDate), ...answer },
    });
    return ok();
  });

  if (result.ok) refresh(windowId);
  return result;
}
