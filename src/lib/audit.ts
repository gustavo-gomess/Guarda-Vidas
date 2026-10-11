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
  entityType:
    | "User"
    | "Post"
    | "PostCoordinator"
    | "PostAssignment"
    | "AvailabilityWindow"
    | "Availability"
    | "Schedule";
  entityId: string;
  postId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Justification given by the author, when the change requires one. */
  reason?: string | null;
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
      reason: entry.reason?.trim() || null,
    },
  });
}

/** Only the fields that changed, for the audit log. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const keys = (Object.keys(after) as (keyof T)[]).filter(
    (key) => after[key] !== undefined && after[key] !== before[key],
  );
  if (keys.length === 0) return null;
  return {
    before: Object.fromEntries(
      keys.map((key) => [key, before[key]]),
    ) as Partial<T>,
    after: Object.fromEntries(
      keys.map((key) => [key, after[key]]),
    ) as Partial<T>,
  };
}
