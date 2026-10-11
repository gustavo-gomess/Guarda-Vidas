"use server";

import { redirect } from "next/navigation";

import { changePasswordSchema, loginSchema } from "@/features/auth/schemas";
import { authenticate, LOGIN_FAILED_MESSAGE } from "@/lib/auth/auth-service";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  clearSession,
  getAuthStore,
  getCurrentSession,
  requireActor,
  setSessionCookie,
} from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fail, invalidInput, type ActionResult } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function loginAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await authenticate(getAuthStore(), parsed.data, new Date());
  if (!result.ok) {
    // The attempted username is not logged: it may be a typo of a password.
    logger.warn("auth.login failed", {
      reason: result.reason,
      userId: result.userId,
    });
    return fail(LOGIN_FAILED_MESSAGE);
  }

  await setSessionCookie(result.userId);
  logger.info("auth.login succeeded", { userId: result.userId });
  redirect(result.mustChangePassword ? "/conta/senha" : "/");
}

export async function logoutAction(): Promise<void> {
  const session = await getCurrentSession();
  await clearSession();
  if (session) logger.info("auth.logout", { userId: session.actor.id });
  redirect("/login");
}

export async function changePasswordAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor({ allowPendingPasswordChange: true });
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return invalidInput(parsed.error);

  const db = getDb();
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return fail("Senha atual incorreta.");
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: { passwordHash, mustChangePassword: false },
    });
    // Sign out every other device.
    await tx.session.deleteMany({
      where: { userId: actor.id, id: { not: session.sessionId } },
    });
  });

  logger.info("auth.password changed", { userId: actor.id });
  redirect("/");
}
