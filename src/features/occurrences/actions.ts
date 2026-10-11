"use server";

import { revalidatePath } from "next/cache";

import { fieldsSchema, type FieldValue } from "@/features/occurrences/fields";
import { categoryChanged, planOccurrence } from "@/features/occurrences/rules";
import {
  annulSchema,
  createCategorySchema,
  createOccurrenceSchema,
  updateCategorySchema,
  type CreateOccurrencePayload,
} from "@/features/occurrences/schemas";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import {
  canAnnulOccurrence,
  canManageOccurrenceCategories,
  canRecordOccurrence,
  type Actor,
} from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
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

// --- Categories (administrators) ---------------------------------------------

function readCategory(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    fields: formData.get("fields") ?? "[]",
  };
}

export async function createCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManageOccurrenceCategories(actor)) {
    return denied(actor, "occurrence_category.create");
  }
  const parsed = createCategorySchema.safeParse(readCategory(formData));
  if (!parsed.success) return invalidInput(parsed.error);
  const { name, description, fields } = parsed.data;

  await getDb().$transaction(async (tx) => {
    const category = await tx.occurrenceCategory.create({
      data: { createdById: actor.id },
    });
    await tx.occurrenceCategoryVersion.create({
      data: {
        categoryId: category.id,
        version: 1,
        name,
        description,
        active: true,
        fields: fields as Prisma.InputJsonValue,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "occurrence_category.create",
      entityType: "OccurrenceCategory",
      entityId: category.id,
      after: { name, fields: fields.length },
    });
  });
  revalidatePath("/admin/ocorrencias");
  return ok();
}

/** Any change is a new version; old records keep their version's fields. */
export async function updateCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManageOccurrenceCategories(actor)) {
    return denied(actor, "occurrence_category.update");
  }
  const parsed = updateCategorySchema.safeParse({
    ...readCategory(formData),
    categoryId: formData.get("categoryId"),
    active: formData.get("active") ?? "true",
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { categoryId, ...next } = parsed.data;

  const result = await getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "OccurrenceCategory" WHERE "id" = ${categoryId}::uuid FOR UPDATE`;
    const latest = await tx.occurrenceCategoryVersion.findFirst({
      where: { categoryId },
      orderBy: { version: "desc" },
    });
    if (!latest) return fail("Categoria não encontrada.");
    const current = {
      name: latest.name,
      description: latest.description,
      active: latest.active,
      fields: fieldsSchema.parse(latest.fields),
    };
    if (!categoryChanged(current, next)) return ok();
    const version = latest.version + 1;
    await tx.occurrenceCategoryVersion.create({
      data: {
        categoryId,
        version,
        name: next.name,
        description: next.description,
        active: next.active,
        fields: next.fields as Prisma.InputJsonValue,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "occurrence_category.update",
      entityType: "OccurrenceCategory",
      entityId: categoryId,
      before: {
        version: latest.version,
        name: current.name,
        active: current.active,
      },
      after: {
        version,
        name: next.name,
        active: next.active,
        fields: next.fields.length,
      },
    });
    return ok();
  });
  if (result.ok) revalidatePath("/admin/ocorrencias");
  return result;
}

// --- Records (lifeguards of the post's team) ----------------------------------

export type OccurrenceSaved = {
  id: string;
  recordedAt: string;
  alreadySaved: boolean;
};

async function createOnce(
  actor: Actor,
  input: ReturnType<typeof createOccurrenceSchema.parse>,
): Promise<ActionResult<OccurrenceSaved>> {
  return getDb().$transaction(async (tx) => {
    const existing = await tx.occurrence.findUnique({
      where: { id: input.id },
      select: { authorId: true, recordedAt: true },
    });
    const version = await tx.occurrenceCategoryVersion.findFirst({
      where: { categoryId: input.categoryId },
      orderBy: { version: "desc" },
      select: { id: true, name: true, active: true, fields: true },
    });
    const plan = planOccurrence({
      actorId: actor.id,
      canRecord: canRecordOccurrence(actor, input.postId),
      existing,
      category: version && {
        active: version.active,
        fields: fieldsSchema.parse(version.fields),
      },
      rawValues: input.values,
      occurredAt: input.occurredAt,
      now: new Date(),
    });
    if (plan.type === "error") {
      return { ok: false, error: plan.message, fieldErrors: plan.fieldErrors };
    }
    if (plan.type === "already-stored") {
      return ok({
        id: input.id,
        recordedAt: existing!.recordedAt.toISOString(),
        alreadySaved: true,
      });
    }

    const record = await tx.occurrence.create({
      data: {
        id: input.id,
        postId: input.postId,
        authorId: actor.id,
        categoryId: input.categoryId,
        categoryVersionId: version!.id,
        occurredAt: input.occurredAt,
        description: input.description,
        values: plan.values as Record<
          string,
          FieldValue
        > as Prisma.InputJsonValue,
      },
      select: { id: true, recordedAt: true },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "occurrence.create",
      entityType: "Occurrence",
      entityId: record.id,
      postId: input.postId,
      // The category only; the content stays on the record.
      after: {
        category: version!.name,
        occurredAt: input.occurredAt.toISOString(),
      },
    });
    return ok({
      id: record.id,
      recordedAt: record.recordedAt.toISOString(),
      alreadySaved: false,
    });
  });
}

/**
 * Registers an occurrence. Called by the screen with an object; the id is
 * generated by the browser, so a retry after a lost answer stores nothing
 * new. Online only (offline not approved, OD-40).
 */
export async function createOccurrenceAction(
  payload: CreateOccurrencePayload,
): Promise<ActionResult<OccurrenceSaved>> {
  const actor = await requireActor();
  const parsed = createOccurrenceSchema.safeParse(payload);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!canRecordOccurrence(actor, parsed.data.postId)) {
    return denied(actor, "occurrence.create", parsed.data.postId);
  }

  let result: ActionResult<OccurrenceSaved>;
  try {
    result = await createOnce(actor, parsed.data);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    result = await createOnce(actor, parsed.data);
  }
  if (result.ok) revalidatePath("/ocorrencias");
  return result;
}

/** Marks a record as registered by mistake. The record is kept unchanged. */
export async function annulOccurrenceAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = annulSchema.safeParse({
    occurrenceId: formData.get("occurrenceId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { occurrenceId, reason } = parsed.data;

  const db = getDb();
  const record = await db.occurrence.findUnique({
    where: { id: occurrenceId },
    select: {
      postId: true,
      authorId: true,
      annulment: { select: { id: true } },
    },
  });
  if (!record) return fail("Registro não encontrado.");
  if (!canAnnulOccurrence(actor, record)) {
    return denied(actor, "occurrence.annul", record.postId);
  }
  if (record.annulment) return fail("Este registro já foi anulado.");

  try {
    await db.$transaction(async (tx) => {
      await tx.occurrenceAnnulment.create({
        data: { occurrenceId, byId: actor.id, reason },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "occurrence.annul",
        entityType: "Occurrence",
        entityId: occurrenceId,
        postId: record.postId,
        reason,
      });
    });
  } catch (error) {
    // Two annulments at the same moment: one is kept.
    if (isUniqueConstraintError(error))
      return fail("Este registro já foi anulado.");
    throw error;
  }
  revalidatePath("/ocorrencias");
  revalidatePath(`/ocorrencias/${occurrenceId}`);
  return ok();
}
