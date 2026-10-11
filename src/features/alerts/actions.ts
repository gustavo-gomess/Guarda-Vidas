"use server";

import { revalidatePath } from "next/cache";

import {
  checkTransition,
  targetOf,
  type AlertStatus,
} from "@/features/alerts/rules";
import { transitionSchema } from "@/features/alerts/schemas";
import { recordAudit } from "@/lib/audit";
import { canManageAlerts, canViewAlert } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fail, invalidInput, ok, type ActionResult } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Acknowledge, start, close or cancel an alert. The form carries the state
 * the user saw: if the alert changed meanwhile, nothing happens and the
 * user is told. The row is locked so two coordinators cannot both act on
 * the same state. Every change is an AlertEvent plus a history entry.
 */
export async function transitionAlertAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = transitionSchema.safeParse({
    alertId: formData.get("alertId"),
    action: formData.get("action"),
    expectedStatus: formData.get("expectedStatus"),
    note: formData.get("note") ?? "",
    confirmed: formData.get("confirmed") ?? undefined,
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { alertId, action, expectedStatus, note, confirmed } = parsed.data;

  const db = getDb();
  const owner = await db.reinforcementAlert.findUnique({
    where: { id: alertId },
    select: { postId: true, authorId: true },
  });
  if (!owner || !canViewAlert(actor, owner))
    return fail("Alerta não encontrado.");
  const canManage = canManageAlerts(actor, owner.postId);
  const isAuthor = owner.authorId === actor.id;
  if (!canManage && !(action === "CANCEL" && isAuthor)) {
    logger.warn("authz.denied", {
      actorId: actor.id,
      action: `alert.${action.toLowerCase()}`,
      postId: owner.postId,
    });
    return fail("Você não tem permissão para esta operação.");
  }

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ReinforcementAlert" WHERE "id" = ${alertId}::uuid FOR UPDATE`;
    const alert = await tx.reinforcementAlert.findUniqueOrThrow({
      where: { id: alertId },
      select: { status: true },
    });
    const error = checkTransition({
      action,
      expectedStatus,
      current: alert.status,
      note,
      confirmed: confirmed === "on",
      canManage,
      isAuthor,
    });
    if (error) return fail(error);

    const to: AlertStatus = targetOf(action);
    await tx.reinforcementAlert.update({
      where: { id: alertId },
      data: { status: to },
    });
    await tx.alertEvent.create({
      data: {
        alertId,
        actorId: actor.id,
        fromStatus: alert.status,
        toStatus: to,
        note,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: `alert.${action.toLowerCase()}`,
      entityType: "ReinforcementAlert",
      entityId: alertId,
      postId: owner.postId,
      before: { status: alert.status },
      after: { status: to },
      reason: note || null,
    });
    return ok();
  });

  if (result.ok) {
    revalidatePath("/alertas");
    revalidatePath(`/alertas/${alertId}`);
  }
  return result;
}
