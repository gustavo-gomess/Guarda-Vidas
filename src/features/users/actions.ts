"use server";

import { revalidatePath } from "next/cache";

import {
  assignmentsToRemove,
  changedFields,
  checkUserChange,
} from "@/features/users/rules";
import {
  createUserSchema,
  updateUserSchema,
  userIdSchema,
} from "@/features/users/schemas";
import { recordAudit } from "@/lib/audit";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { canManageUsers } from "@/lib/auth/policy";
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

/** The temporary password is returned once, to be handed to the user. */
export type TemporaryPasswordResult = ActionResult<{
  userId: string;
  temporaryPassword: string;
}>;

export async function createUserAction(
  _previous: TemporaryPasswordResult | null,
  formData: FormData,
): Promise<TemporaryPasswordResult> {
  const actor = await requireActor();
  if (!canManageUsers(actor)) {
    logger.warn("authz.denied", { actorId: actor.id, action: "user.create" });
    return fail(FORBIDDEN);
  }

  const parsed = createUserSchema.safeParse({
    username: formData.get("username"),
    name: formData.get("name"),
    role: formData.get("role"),
    isAdmin: formData.get("isAdmin"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const data = parsed.data;

  if (data.isAdmin && data.role === "LIFEGUARD") {
    return fail("Guarda-vidas não pode ser administrador.");
  }

  const db = getDb();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  let user: { id: string };
  try {
    user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { ...data, passwordHash, mustChangePassword: true },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "user.create",
        entityType: "User",
        entityId: created.id,
        after: {
          username: data.username,
          name: data.name,
          role: data.role,
          isAdmin: data.isAdmin,
          active: true,
        },
      });
      return created;
    });
  } catch (error) {
    // The unique index decides, so two simultaneous creations cannot both win.
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        error: "Confira os campos destacados.",
        fieldErrors: { username: ["Este usuário já existe."] },
      };
    }
    throw error;
  }

  logger.info("user.created", { actorId: actor.id, userId: user.id });
  revalidatePath("/admin/usuarios");
  return ok({ userId: user.id, temporaryPassword });
}

export async function updateUserAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!canManageUsers(actor)) {
    logger.warn("authz.denied", { actorId: actor.id, action: "user.update" });
    return fail(FORBIDDEN);
  }

  const parsed = updateUserSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    role: formData.get("role"),
    isAdmin: formData.get("isAdmin"),
    active: formData.get("active"),
  });
  if (!parsed.success) return invalidInput(parsed.error);
  const { userId, ...change } = parsed.data;

  const db = getDb();
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, isAdmin: true, active: true },
  });
  if (!target) return fail("Usuário não encontrado.");

  const otherActiveAdmins = await db.user.count({
    where: { isAdmin: true, active: true, id: { not: target.id } },
  });
  const problem = checkUserChange({
    actorId: actor.id,
    target,
    change,
    otherActiveAdmins,
  });
  if (problem) return fail(problem);

  const diff = changedFields(target, change);
  if (!diff) return ok();

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: change });

    if (change.role !== target.role) {
      const remove = assignmentsToRemove(change.role);
      if (remove.coordinatedPosts) {
        const removed = await tx.postCoordinator.findMany({
          where: { userId: target.id },
          select: { postId: true },
        });
        await tx.postCoordinator.deleteMany({ where: { userId: target.id } });
        for (const { postId } of removed) {
          await recordAudit(tx, {
            actorId: actor.id,
            action: "post.coordinator_remove",
            entityType: "PostCoordinator",
            entityId: target.id,
            postId,
            before: { userId: target.id },
          });
        }
      }
      if (remove.postAssignments) {
        const removed = await tx.postAssignment.findMany({
          where: { userId: target.id },
          select: { postId: true, isCaptain: true },
        });
        await tx.postAssignment.deleteMany({ where: { userId: target.id } });
        for (const { postId, isCaptain } of removed) {
          await recordAudit(tx, {
            actorId: actor.id,
            action: "post.assignment_remove",
            entityType: "PostAssignment",
            entityId: target.id,
            postId,
            before: { userId: target.id, isCaptain },
          });
        }
      }
    }

    // Deactivated users lose every open session immediately.
    if (!change.active) {
      await tx.session.deleteMany({ where: { userId: target.id } });
    }

    await recordAudit(tx, {
      actorId: actor.id,
      action: "user.update",
      entityType: "User",
      entityId: target.id,
      before: diff.before,
      after: diff.after,
    });
  });

  logger.info("user.updated", { actorId: actor.id, userId: target.id });
  revalidatePath("/admin/usuarios");
  return ok();
}

export async function resetPasswordAction(
  _previous: TemporaryPasswordResult | null,
  formData: FormData,
): Promise<TemporaryPasswordResult> {
  const actor = await requireActor();
  if (!canManageUsers(actor)) {
    logger.warn("authz.denied", {
      actorId: actor.id,
      action: "user.password_reset",
    });
    return fail(FORBIDDEN);
  }

  const parsed = userIdSchema.safeParse(formData.get("userId"));
  if (!parsed.success) return fail("Usuário inválido.");
  const userId = parsed.data;

  if (userId === actor.id) {
    return fail("Para trocar a sua senha, use Minha conta > Alterar senha.");
  }

  const db = getDb();
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) return fail("Usuário não encontrado.");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "user.password_reset",
      entityType: "User",
      entityId: userId,
      after: { mustChangePassword: true },
    });
  });

  logger.info("user.password_reset", { actorId: actor.id, userId });
  return ok({ userId, temporaryPassword });
}
