import type { Prisma } from "@/generated/prisma/client";

/** Fields that must never be written to the audit log. */
const FORBIDDEN_FIELDS = new Set([
  "passwordHash",
  "password",
  "token",
  "failedLoginAttempts",
  "lockedUntil",
]);

export type AuditEntry = {
  /** Null only for the command-line bootstrap. */
  actorId: string | null;
  action: string;
  entityType: "User" | "Post" | "PostCoordinator" | "PostAssignment";
  entityId: string;
  postId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

function clean(
  values: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !FORBIDDEN_FIELDS.has(key) && value !== undefined,
    ),
  ) as Prisma.InputJsonValue;
}

/**
 * Appends a history entry. Call it with the same transaction client as the
 * change itself, so a change is never saved without its history.
 */
export async function recordAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      postId: entry.postId ?? null,
      before: clean(entry.before),
      after: clean(entry.after),
    },
  });
}
