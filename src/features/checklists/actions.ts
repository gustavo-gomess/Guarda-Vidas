"use server";

import { revalidatePath } from "next/cache";

import {
  itemChanged,
  planSave,
  snapshotLines,
  type ChecklistStatus,
  type RevisionKind,
} from "@/features/checklists/rules";
import {
  createItemSchema,
  saveChecklistSchema,
  setItemActiveSchema,
  startChecklistSchema,
  updateItemSchema,
  type SaveChecklistPayload,
} from "@/features/checklists/schemas";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import {
  canFillChecklist,
  canManageChecklistItems,
  type Actor,
} from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { fromDbDate } from "@/lib/dates";
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

function denied(actor: Actor, action: string, postId?: string) {
  logger.warn("authz.denied", { actorId: actor.id, action, postId });
  return fail(FORBIDDEN);
}

// --- Item list (the post's coordinator) --------------------------------------

function refreshItems(postId: string) {
  revalidatePath(`/postos/${postId}/itens`);
  revalidatePath(`/postos/${postId}`);
}

async function latestVersion(tx: Prisma.TransactionClient, itemId: string) {
  // Serializes changes to the same item (version numbers stay sequential).
  await tx.$executeRaw`SELECT 1 FROM "ChecklistItem" WHERE "id" = ${itemId}::uuid FOR UPDATE`;
  return tx.checklistItemVersion.findFirst({
    where: { itemId },
    orderBy: { version: "desc" },
    select: {
      version: true,
      label: true,
      guidance: true,
      position: true,
      active: true,
    },
  });
}

export async function createItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = createItemSchema.safeParse({
    postId: formData.get("postId"),
    label: formData.get("label"),
    guidance: formData.get("guidance") ?? "",
    position: formData.get("position"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { postId, ...content } = parsed.data;
  if (!canManageChecklistItems(actor, postId)) {
    return denied(actor, "checklist_item.create", postId);
  }

  await getDb().$transaction(async (tx) => {
    const item = await tx.checklistItem.create({
      data: { postId, createdById: actor.id },
    });
    await tx.checklistItemVersion.create({
      data: {
        itemId: item.id,
        version: 1,
        ...content,
        active: true,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "checklist_item.create",
      entityType: "ChecklistItem",
      entityId: item.id,
      postId,
      after: { ...content, version: 1 },
    });
  });

  refreshItems(postId);
  return ok();
}

/** Any change creates a new version; old checklists keep the old one. */
async function changeItem(
  actor: Actor,
  itemId: string,
  change: (current: {
    label: string;
    guidance: string;
    position: number;
    active: boolean;
  }) => { label: string; guidance: string; position: number; active: boolean },
  action: string,
): Promise<ActionResult> {
  const db = getDb();
  const item = await db.checklistItem.findUnique({
    where: { id: itemId },
    select: { postId: true },
  });
  if (!item) return fail("Item não encontrado.");
  // The post comes from the item in the database, never from the form.
  if (!canManageChecklistItems(actor, item.postId)) {
    return denied(actor, action, item.postId);
  }

  const result = await db.$transaction(async (tx) => {
    const latest = await latestVersion(tx, itemId);
    if (!latest) return fail("Item sem versão.");
    const { version: currentNumber, ...current } = latest;
    const next = change(current);
    if (!itemChanged(current, next)) return ok();
    const version = currentNumber + 1;
    await tx.checklistItemVersion.create({
      data: { itemId, version, ...next, createdById: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action,
      entityType: "ChecklistItem",
      entityId: itemId,
      postId: item.postId,
      before: { ...current, version: currentNumber },
      after: { ...next, version },
    });
    return ok();
  });

  if (result.ok) refreshItems(item.postId);
  return result;
}

export async function updateItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = updateItemSchema.safeParse({
    itemId: formData.get("itemId"),
    label: formData.get("label"),
    guidance: formData.get("guidance") ?? "",
    position: formData.get("position"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { itemId, ...content } = parsed.data;
  return changeItem(
    actor,
    itemId,
    (current) => ({ ...current, ...content }),
    "checklist_item.update",
  );
}

export async function setItemActiveAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = setItemActiveSchema.safeParse({
    itemId: formData.get("itemId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { itemId, active } = parsed.data;
  return changeItem(
    actor,
    itemId,
    (current) => ({ ...current, active }),
    active ? "checklist_item.reactivate" : "checklist_item.deactivate",
  );
}

// --- Checklist of an assumption (its lifeguard) -------------------------------

/**
 * Starts the checklist of a journey with a frozen copy of the post's
 * current list. Starting twice returns the same checklist.
 */
export async function startChecklistAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = startChecklistSchema.safeParse({
    journeyId: formData.get("journeyId"),
  });
  if (!parsed.success) return fail("Jornada inválida.");
  const { journeyId } = parsed.data;

  const db = getDb();
  const journey = await db.journey.findUnique({
    where: { id: journeyId },
    select: { userId: true, postId: true, date: true },
  });
  if (!journey) return fail("Jornada não encontrada.");
  if (!canFillChecklist(actor, journey.userId)) {
    return denied(actor, "checklist.start", journey.postId);
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.checklist.findUnique({
        where: { journeyId },
        select: { id: true },
      });
      if (existing) return ok();

      const items = await tx.checklistItem.findMany({
        where: { postId: journey.postId },
        select: {
          id: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              label: true,
              guidance: true,
              position: true,
              active: true,
            },
          },
        },
      });
      const lines = snapshotLines(
        items.flatMap((item) =>
          item.versions.map((version) => ({
            ...version,
            itemId: item.id,
            versionId: version.id,
          })),
        ),
      );
      if (lines.length === 0) {
        return fail(
          "Este posto ainda não tem lista de itens. Avise a coordenação.",
        );
      }

      const checklist = await tx.checklist.create({
        data: {
          journeyId,
          userId: actor.id,
          postId: journey.postId,
          date: journey.date,
        },
      });
      await tx.checklistLine.createMany({
        data: lines.map((line) => ({ ...line, checklistId: checklist.id })),
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "checklist.start",
        entityType: "Checklist",
        entityId: checklist.id,
        postId: journey.postId,
        after: { date: fromDbDate(journey.date), items: lines.length },
      });
      return ok();
    });
    if (result.ok) revalidatePath(`/checklists/${journeyId}`);
    return result;
  } catch (error) {
    // Started at the same moment in another tab: that one is kept.
    if (isUniqueConstraintError(error)) return ok();
    throw error;
  }
}

export type SaveResult = {
  kind: RevisionKind | null;
  number: number | null;
  status: ChecklistStatus;
  alreadySaved: boolean;
};

async function saveOnce(
  actor: Actor,
  payload: ReturnType<typeof saveChecklistSchema.parse>,
  owner: { postId: string; journeyId: string },
): Promise<ActionResult<SaveResult>> {
  const { checklistId, requestId } = payload;
  return getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Checklist" WHERE "id" = ${checklistId}::uuid FOR UPDATE`;
    const checklist = await tx.checklist.findUniqueOrThrow({
      where: { id: checklistId },
      select: {
        userId: true,
        status: true,
        lines: { select: { id: true }, orderBy: { position: "asc" } },
        currentRevision: {
          select: {
            number: true,
            generalNote: true,
            answers: { select: { lineId: true, state: true, note: true } },
          },
        },
      },
    });
    const existing = await tx.checklistRevision.findUnique({
      where: { id: requestId },
      select: { checklistId: true, kind: true, number: true },
    });

    const plan = planSave(payload, {
      actorId: actor.id,
      checklist: {
        userId: checklist.userId,
        status: checklist.status,
        lineIds: checklist.lines.map((line) => line.id),
      },
      existingRevision: existing && {
        checklistId: existing.checklistId,
        matchesThisChecklist: existing.checklistId === checklistId,
      },
      latest: checklist.currentRevision,
      nextNumber: (checklist.currentRevision?.number ?? 0) + 1,
    });

    if (plan.type === "error") return fail(plan.message);
    if (plan.type === "already-saved" || plan.type === "unchanged") {
      return ok({
        kind: existing?.kind ?? null,
        number: existing?.number ?? null,
        status: checklist.status,
        alreadySaved: plan.type === "already-saved",
      });
    }

    const now = new Date();
    await tx.checklistRevision.create({
      data: {
        id: requestId,
        checklistId,
        number: plan.number,
        kind: plan.kind,
        authorId: actor.id,
        generalNote: payload.generalNote.trim(),
        reason: plan.kind === "CORRECTION" ? payload.reason.trim() : "",
        createdAt: now,
      },
    });
    await tx.checklistAnswer.createMany({
      data: plan.answers.map((answer) => ({
        ...answer,
        revisionId: requestId,
      })),
    });
    const status: ChecklistStatus = plan.submits
      ? "SUBMITTED"
      : checklist.status;
    await tx.checklist.update({
      where: { id: checklistId },
      data: {
        currentRevisionId: requestId,
        status,
        ...(plan.submits ? { submittedAt: now } : {}),
      },
    });
    if (plan.kind !== "DRAFT") {
      await recordAudit(tx, {
        actorId: actor.id,
        action:
          plan.kind === "SUBMISSION" ? "checklist.submit" : "checklist.correct",
        entityType: "Checklist",
        entityId: checklistId,
        postId: owner.postId,
        after: {
          revision: plan.number,
          problems: plan.answers.filter(
            (answer) => answer.state !== null && answer.state !== "OK",
          ).length,
        },
        reason: plan.kind === "CORRECTION" ? payload.reason : null,
      });
    }
    return ok({
      kind: plan.kind,
      number: plan.number,
      status,
      alreadySaved: false,
    });
  });
}

/**
 * Saves a draft, sends, or corrects a sent checklist. Called by the screen
 * with an object. Safe to repeat: the same requestId is stored once.
 */
export async function saveChecklistAction(
  payload: SaveChecklistPayload,
): Promise<ActionResult<SaveResult>> {
  const actor = await requireActor();
  const parsed = saveChecklistSchema.safeParse(payload);
  if (!parsed.success) return invalidInput(parsed.error);

  const owner = await getDb().checklist.findUnique({
    where: { id: parsed.data.checklistId },
    select: { userId: true, postId: true, journeyId: true },
  });
  if (!owner) return fail("Checklist não encontrado.");
  if (!canFillChecklist(actor, owner.userId)) {
    return denied(actor, "checklist.save", owner.postId);
  }

  let result: ActionResult<SaveResult>;
  try {
    result = await saveOnce(actor, parsed.data, owner);
  } catch (error) {
    // The same request arrived twice at once: the second sees the first.
    if (!isUniqueConstraintError(error)) throw error;
    result = await saveOnce(actor, parsed.data, owner);
  }

  if (result.ok) {
    revalidatePath(`/checklists/${owner.journeyId}`);
    revalidatePath("/checklists");
    revalidatePath("/checklists/problemas");
  }
  return result;
}
