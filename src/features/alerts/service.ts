import { ACTIVE_STATUSES, planCreate } from "@/features/alerts/rules";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { canCreateAlert, type Actor } from "@/lib/auth/policy";
import { isUniqueConstraintError } from "@/lib/errors";

/**
 * Stores a reinforcement alert. The answer is sent only after the alert and
 * its first event are committed, so "sent" always means "on the server".
 */

export type AlertInput = {
  id: string;
  postId: string;
  description: string;
  deviceTime: Date;
  allowAnotherActive: boolean;
};

export type AlertSummary = {
  id: string;
  status: string;
  createdAt: string;
};

export type CreateAlertResult =
  | { ok: true; created: boolean; alert: AlertSummary }
  | {
      ok: false;
      httpStatus: number;
      code: string;
      message: string;
      activeAlertId?: string;
    };

const summaryFields = {
  id: true,
  status: true,
  createdAt: true,
  authorId: true,
  postId: true,
  description: true,
} as const;

async function attempt(
  db: PrismaClient,
  actor: Actor,
  input: AlertInput,
): Promise<CreateAlertResult> {
  return db.$transaction(async (tx) => {
    const existing = await tx.reinforcementAlert.findUnique({
      where: { id: input.id },
      select: summaryFields,
    });
    const activeOnPost = await tx.reinforcementAlert.findFirst({
      where: {
        postId: input.postId,
        status: { in: [...ACTIVE_STATUSES] },
        id: { not: input.id },
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    const plan = planCreate({
      canCreate: canCreateAlert(actor, input.postId),
      actorId: actor.id,
      existing,
      postId: input.postId,
      description: input.description,
      activeOnPost,
      allowAnotherActive: input.allowAnotherActive,
    });
    if (plan.type === "error") {
      return {
        ok: false,
        httpStatus: plan.httpStatus,
        code: plan.code,
        message: plan.message,
        activeAlertId: plan.activeAlertId,
      };
    }
    if (plan.type === "already-stored") {
      return {
        ok: true,
        created: false,
        alert: {
          id: existing!.id,
          status: existing!.status,
          createdAt: existing!.createdAt.toISOString(),
        },
      };
    }

    const alert = await tx.reinforcementAlert.create({
      data: {
        id: input.id,
        postId: input.postId,
        authorId: actor.id,
        description: input.description,
        deviceTime: input.deviceTime,
      },
      select: summaryFields,
    });
    await tx.alertEvent.create({
      data: {
        alertId: alert.id,
        actorId: actor.id,
        fromStatus: null,
        toStatus: "OPEN",
        note:
          input.allowAnotherActive && activeOnPost
            ? "Enviado com outro alerta ativo no posto (confirmado pelo autor)"
            : "",
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "alert.create",
      entityType: "ReinforcementAlert",
      entityId: alert.id,
      postId: input.postId,
      after: { status: "OPEN", description: input.description },
    });
    return {
      ok: true,
      created: true,
      alert: {
        id: alert.id,
        status: alert.status,
        createdAt: alert.createdAt.toISOString(),
      },
    };
  });
}

export async function createAlert(
  db: PrismaClient,
  actor: Actor,
  input: AlertInput,
): Promise<CreateAlertResult> {
  try {
    return await attempt(db, actor, input);
  } catch (error) {
    // The same alert sent twice at the same moment: the retry sees it.
    if (!isUniqueConstraintError(error)) throw error;
    return attempt(db, actor, input);
  }
}
