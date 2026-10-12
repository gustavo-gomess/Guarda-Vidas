"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isoDateSchema } from "@/features/availability/schemas";
import {
  checkClosingAction,
  nextStatus,
  VERSION_KIND,
} from "@/features/reports/closing-rules";
import { loadSummaries } from "@/features/reports/load";
import { toDaySummary } from "@/features/reports/summary";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { canCloseDay } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { operationalToday, toDbDate } from "@/lib/dates";
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
 * Daily closing actions. A closing reads the day's records and freezes a
 * summary in a new version; it never changes or deletes those records.
 * The form carries the version the user saw, so a double click or a
 * second coordinator cannot freeze twice from the same state.
 */

const postDay = z.object({
  postId: z.uuid("Posto inválido."),
  date: isoDateSchema,
});

const notesSchema = postDay.extend({
  notes: z.string().trim().max(2000, "Use no máximo 2000 caracteres."),
});

const actionSchema = postDay.extend({
  action: z.enum(["SUBMIT", "CONSOLIDATE", "CORRECT"], {
    error: "Ação inválida.",
  }),
  expectedVersion: z.coerce.number().int().min(0),
  reason: z.string().trim().max(500, "Use no máximo 500 caracteres."),
});

function refresh(postId: string, date: string) {
  revalidatePath("/fechamento");
  revalidatePath(`/fechamento/${postId}/${date}`);
  revalidatePath("/");
}

async function lockClosing(
  tx: Prisma.TransactionClient,
  postId: string,
  date: string,
) {
  await tx.$executeRaw`SELECT 1 FROM "DailyClosing" WHERE "postId" = ${postId}::uuid AND "date" = ${date}::date FOR UPDATE`;
  return tx.dailyClosing.findUnique({
    where: { postId_date: { postId, date: toDbDate(date) } },
    select: { id: true, status: true, notes: true, currentVersion: true },
  });
}

/** Creates the draft, or updates its notes. Frozen versions keep their own. */
export async function saveClosingNotesAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = notesSchema.safeParse({
    postId: formData.get("postId"),
    date: formData.get("date"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { postId, date, notes } = parsed.data;
  if (!canCloseDay(actor, postId)) {
    logger.warn("authz.denied", {
      actorId: actor.id,
      action: "closing.notes",
      postId,
    });
    return fail("Você não tem permissão para esta operação.");
  }
  if (date > operationalToday(new Date())) {
    return fail("Não é possível fechar um dia que ainda não chegou.");
  }

  try {
    await getDb().$transaction(async (tx) => {
      const closing = await lockClosing(tx, postId, date);
      if (!closing) {
        await tx.dailyClosing.create({
          data: { postId, date: toDbDate(date), notes, createdById: actor.id },
        });
        await recordAudit(tx, {
          actorId: actor.id,
          action: "closing.draft",
          entityType: "DailyClosing",
          entityId: `${postId}:${date}`,
          postId,
          after: { date, status: "DRAFT" },
        });
      } else if (closing.notes !== notes) {
        await tx.dailyClosing.update({
          where: { id: closing.id },
          data: { notes },
        });
      }
    });
  } catch (error) {
    if (isUniqueConstraintError(error))
      return fail("O fechamento acabou de ser criado. Recarregue a página.");
    throw error;
  }
  refresh(postId, date);
  return ok();
}

/** Send, consolidate or correct: freezes a new version of the day's summary. */
export async function closingAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = actionSchema.safeParse({
    postId: formData.get("postId"),
    date: formData.get("date"),
    action: formData.get("action"),
    expectedVersion: formData.get("expectedVersion"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { postId, date, action, expectedVersion, reason } = parsed.data;
  const canClose = canCloseDay(actor, postId);
  if (!canClose) {
    logger.warn("authz.denied", {
      actorId: actor.id,
      action: `closing.${action.toLowerCase()}`,
      postId,
    });
    return fail("Você não tem permissão para esta operação.");
  }
  const today = operationalToday(new Date());

  try {
    const result = await getDb().$transaction(async (tx) => {
      const closing = await lockClosing(tx, postId, date);
      // The summary frozen is exactly what this transaction read.
      const { summaries } = await loadSummaries(
        tx,
        { postIds: [postId] },
        date,
        date,
      );
      const summary = summaries[0];
      if (!summary) return fail("Posto não encontrado ou desativado.");

      const error = checkClosingAction({
        action,
        canClose,
        status: closing?.status ?? null,
        expectedVersion,
        currentVersion: closing?.currentVersion ?? 0,
        date,
        today,
        pendingTotal: summary.pending.total,
        reason,
      });
      if (error) return fail(error);

      const target =
        closing ??
        (await tx.dailyClosing.create({
          data: { postId, date: toDbDate(date), createdById: actor.id },
          select: { id: true, status: true, notes: true, currentVersion: true },
        }));
      const version = target.currentVersion + 1;
      const status = nextStatus(action);
      await tx.dailyClosingVersion.create({
        data: {
          closingId: target.id,
          version,
          kind: VERSION_KIND[action],
          summary: toDaySummary(summary) as unknown as Prisma.InputJsonValue,
          pendingCount: summary.pending.total,
          notes: target.notes,
          reason: action === "CORRECT" ? reason : "",
          authorId: actor.id,
        },
      });
      await tx.dailyClosing.update({
        where: { id: target.id },
        data: { status, currentVersion: version },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: `closing.${action.toLowerCase()}`,
        entityType: "DailyClosing",
        entityId: `${postId}:${date}`,
        postId,
        before: { status: closing?.status ?? null, version: version - 1 },
        after: { status, version, pending: summary.pending.total },
        reason: action === "CORRECT" ? reason : null,
      });
      return ok();
    });
    if (result.ok) refresh(postId, date);
    return result;
  } catch (error) {
    // Two first submissions at the same moment: one wins.
    if (isUniqueConstraintError(error)) {
      return fail(
        "O fechamento mudou desde que você abriu a página. Confira a versão atual.",
      );
    }
    throw error;
  }
}
