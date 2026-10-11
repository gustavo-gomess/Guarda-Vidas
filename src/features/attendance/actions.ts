"use server";

import { revalidatePath } from "next/cache";

import { checkDecision } from "@/features/attendance/rules";
import { decisionSchema } from "@/features/attendance/schemas";
import { recordAudit } from "@/lib/audit";
import { canValidateAttendance } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fail, invalidInput, ok, type ActionResult } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Validate, reject or send a presence record to review. Only the status
 * changes; the registered data stays as it arrived (database trigger), and
 * every decision is appended with its author, time and justification.
 */
export async function decideAttendanceAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = decisionSchema.safeParse({
    recordId: formData.get("recordId"),
    decision: formData.get("decision"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { recordId, decision, reason } = parsed.data;

  const db = getDb();
  const owner = await db.attendanceRecord.findUnique({
    where: { id: recordId },
    select: { postId: true, journeyId: true },
  });
  if (!owner) return fail("Registro não encontrado.");
  // The post comes from the record in the database, never from the form.
  if (!canValidateAttendance(actor, owner.postId)) {
    logger.warn("authz.denied", {
      actorId: actor.id,
      action: "attendance.decide",
      postId: owner.postId,
    });
    return fail("Você não tem permissão para esta operação.");
  }

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "AttendanceRecord" WHERE "id" = ${recordId}::uuid FOR UPDATE`;
    const record = await tx.attendanceRecord.findUniqueOrThrow({
      where: { id: recordId },
      select: { status: true },
    });
    const error = checkDecision(record.status, decision, reason);
    if (error) return fail(error);

    await tx.attendanceRecord.update({
      where: { id: recordId },
      data: { status: decision },
    });
    await tx.attendanceDecision.create({
      data: {
        recordId,
        decidedById: actor.id,
        fromStatus: record.status,
        toStatus: decision,
        reason,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "attendance.decide",
      entityType: "AttendanceRecord",
      entityId: recordId,
      postId: owner.postId,
      before: { status: record.status },
      after: { status: decision },
      reason,
    });
    return ok();
  });

  if (result.ok) {
    revalidatePath("/presenca/validacao");
    revalidatePath("/presenca/painel");
    revalidatePath(`/presenca/jornadas/${owner.journeyId}`);
  }
  return result;
}
