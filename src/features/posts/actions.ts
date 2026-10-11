"use server";

import { revalidatePath } from "next/cache";

import {
  postDataSchema,
  postMemberSchema,
  setCaptainSchema,
  setPostStatusSchema,
  updatePostSchema,
} from "@/features/posts/schemas";
import { changedFields, recordAudit } from "@/lib/audit";
import {
  canChangePostStatus,
  canManagePosts,
  canManagePostTeam,
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

function refresh(postId?: string) {
  revalidatePath("/admin/postos");
  revalidatePath("/");
  revalidatePath("/escalas");
  if (postId) revalidatePath(`/postos/${postId}`);
}

// --- Posts (administrators; status also by the post's coordinators) --------

const DUPLICATE_MESSAGE = "Já existe um posto com este código ou nome.";

function readPostData(formData: FormData) {
  return {
    code: formData.get("code"),
    name: formData.get("name"),
    location: formData.get("location") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

/** Field errors for a code or name already used by another post. */
async function duplicateFields(
  data: { code: string; name: string },
  exceptPostId?: string,
): Promise<ActionResult | null> {
  const clashes = await getDb().post.findMany({
    where: {
      OR: [{ code: data.code }, { name: data.name }],
      ...(exceptPostId ? { id: { not: exceptPostId } } : {}),
    },
    select: { code: true, name: true },
  });
  if (clashes.length === 0) return null;
  const fieldErrors: Record<string, string[]> = {};
  if (clashes.some((post) => post.code === data.code)) {
    fieldErrors.code = ["Já existe um posto com este código."];
  }
  if (clashes.some((post) => post.name === data.name)) {
    fieldErrors.name = ["Já existe um posto com este nome."];
  }
  return { ok: false, error: "Confira os campos destacados.", fieldErrors };
}

export async function createPostAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManagePosts(actor)) return denied(actor, "post.create");

  const parsed = postDataSchema.safeParse(readPostData(formData));
  if (!parsed.success) return invalidInput(parsed.error);

  const duplicate = await duplicateFields(parsed.data);
  if (duplicate) return duplicate;

  try {
    await getDb().$transaction(async (tx) => {
      const post = await tx.post.create({ data: parsed.data });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "post.create",
        entityType: "Post",
        entityId: post.id,
        postId: post.id,
        after: { ...parsed.data, status: post.status },
      });
    });
  } catch (error) {
    // Another administrator created the same code or name meanwhile.
    if (isUniqueConstraintError(error)) return fail(DUPLICATE_MESSAGE);
    throw error;
  }

  refresh();
  return ok();
}

export async function updatePostAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManagePosts(actor)) return denied(actor, "post.update");

  const parsed = updatePostSchema.safeParse({
    postId: formData.get("postId"),
    ...readPostData(formData),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { postId, ...data } = parsed.data;

  const db = getDb();
  const post = await db.post.findUnique({
    where: { id: postId },
    select: { code: true, name: true, location: true, notes: true },
  });
  if (!post) return fail("Posto não encontrado.");

  const changes = changedFields(post, data);
  if (!changes) return ok();

  const duplicate = await duplicateFields(data, postId);
  if (duplicate) return duplicate;

  try {
    await db.$transaction(async (tx) => {
      await tx.post.update({ where: { id: postId }, data });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "post.update",
        entityType: "Post",
        entityId: postId,
        postId,
        ...changes,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return fail(DUPLICATE_MESSAGE);
    throw error;
  }

  refresh(postId);
  return ok();
}

export async function setPostStatusAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = setPostStatusSchema.safeParse({
    postId: formData.get("postId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { postId, status } = parsed.data;

  if (!canChangePostStatus(actor, postId)) {
    return denied(actor, "post.status", postId);
  }

  const db = getDb();
  const post = await db.post.findUnique({
    where: { id: postId },
    select: { status: true },
  });
  if (!post) return fail("Posto não encontrado.");
  if (post.status === status) return ok();

  await db.$transaction(async (tx) => {
    await tx.post.update({ where: { id: postId }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "post.update",
      entityType: "Post",
      entityId: postId,
      postId,
      before: { status: post.status },
      after: { status },
    });
  });

  refresh(postId);
  return ok();
}

// --- Coordinator areas (administrators) -------------------------------------

export async function addCoordinatorAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManagePosts(actor)) return denied(actor, "post.coordinator_add");

  const parsed = postMemberSchema.safeParse({
    postId: formData.get("postId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { postId, userId } = parsed.data;

  const db = getDb();
  const [post, user] = await Promise.all([
    db.post.findUnique({ where: { id: postId }, select: { id: true } }),
    db.user.findUnique({
      where: { id: userId },
      select: { role: true, active: true },
    }),
  ]);
  if (!post) return fail("Posto não encontrado.");
  if (!user || !user.active || user.role !== "COORDINATOR") {
    return fail("Escolha um coordenador ativo.");
  }

  await db.$transaction(async (tx) => {
    const existing = await tx.postCoordinator.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) return;
    await tx.postCoordinator.create({ data: { postId, userId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "post.coordinator_add",
      entityType: "PostCoordinator",
      entityId: userId,
      postId,
      after: { userId },
    });
  });

  refresh(postId);
  return ok();
}

export async function removeCoordinatorAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManagePosts(actor)) return denied(actor, "post.coordinator_remove");

  const parsed = postMemberSchema.safeParse({
    postId: formData.get("postId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { postId, userId } = parsed.data;

  await getDb().$transaction(async (tx) => {
    const { count } = await tx.postCoordinator.deleteMany({
      where: { postId, userId },
    });
    if (count === 0) return;
    await recordAudit(tx, {
      actorId: actor.id,
      action: "post.coordinator_remove",
      entityType: "PostCoordinator",
      entityId: userId,
      postId,
      before: { userId },
    });
  });

  refresh(postId);
  return ok();
}

// --- Post team (administrators and the post's coordinators) ----------------

export async function addLifeguardAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = postMemberSchema.safeParse({
    postId: formData.get("postId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { postId, userId } = parsed.data;

  // The post id comes from the browser: authorize against it, never assume.
  if (!canManagePostTeam(actor, postId)) {
    return denied(actor, "post.assignment_add", postId);
  }

  const db = getDb();
  const [post, user] = await Promise.all([
    db.post.findUnique({ where: { id: postId }, select: { status: true } }),
    db.user.findUnique({
      where: { id: userId },
      select: { role: true, active: true },
    }),
  ]);
  if (!post || post.status === "INACTIVE") {
    return fail("Posto não encontrado ou desativado.");
  }
  if (!user || !user.active || user.role !== "LIFEGUARD") {
    return fail("Escolha um guarda-vidas ativo.");
  }

  await db.$transaction(async (tx) => {
    const existing = await tx.postAssignment.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) return;
    await tx.postAssignment.create({ data: { postId, userId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "post.assignment_add",
      entityType: "PostAssignment",
      entityId: userId,
      postId,
      after: { userId, isCaptain: false },
    });
  });

  refresh(postId);
  return ok();
}

export async function removeLifeguardAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = postMemberSchema.safeParse({
    postId: formData.get("postId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { postId, userId } = parsed.data;

  if (!canManagePostTeam(actor, postId)) {
    return denied(actor, "post.assignment_remove", postId);
  }

  await getDb().$transaction(async (tx) => {
    const existing = await tx.postAssignment.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!existing) return;
    await tx.postAssignment.delete({
      where: { postId_userId: { postId, userId } },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "post.assignment_remove",
      entityType: "PostAssignment",
      entityId: userId,
      postId,
      before: { userId, isCaptain: existing.isCaptain },
    });
  });

  refresh(postId);
  return ok();
}

/**
 * Sets or clears the captain of a post. Provisional rule (OD-04): at most one
 * captain per post, so choosing a new one clears the previous captain.
 */
export async function setCaptainAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = setCaptainSchema.safeParse({
    postId: formData.get("postId"),
    userId: formData.get("userId"),
    isCaptain: formData.get("isCaptain"),
  });
  if (!parsed.success) return fail("Dados inválidos.");
  const { postId, userId, isCaptain } = parsed.data;

  if (!canManagePostTeam(actor, postId)) {
    return denied(actor, "post.captain_set", postId);
  }

  const result = await getDb().$transaction(async (tx) => {
    const assignment = await tx.postAssignment.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!assignment) return fail("Este guarda-vidas não está neste posto.");
    if (assignment.isCaptain === isCaptain) return ok();

    if (isCaptain) {
      const previous = await tx.postAssignment.findMany({
        where: { postId, isCaptain: true, userId: { not: userId } },
        select: { userId: true },
      });
      for (const { userId: previousId } of previous) {
        await tx.postAssignment.update({
          where: { postId_userId: { postId, userId: previousId } },
          data: { isCaptain: false },
        });
        await recordAudit(tx, {
          actorId: actor.id,
          action: "post.captain_unset",
          entityType: "PostAssignment",
          entityId: previousId,
          postId,
          before: { isCaptain: true },
          after: { isCaptain: false },
        });
      }
    }

    await tx.postAssignment.update({
      where: { postId_userId: { postId, userId } },
      data: { isCaptain },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: isCaptain ? "post.captain_set" : "post.captain_unset",
      entityType: "PostAssignment",
      entityId: userId,
      postId,
      before: { isCaptain: !isCaptain },
      after: { isCaptain },
    });
    return ok();
  });

  if (result.ok) refresh(postId);
  return result;
}
