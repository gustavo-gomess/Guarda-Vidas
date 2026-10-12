import "server-only";

import { fieldsSchema } from "@/features/occurrences/fields";
import { postScope } from "@/features/schedules/scope";
import type { Prisma } from "@/generated/prisma/client";
import {
  canAnnulOccurrence,
  canManageOccurrenceCategories,
  canViewAvailability,
  canViewOccurrences,
  type Actor,
} from "@/lib/auth/policy";
import { operationalRange } from "@/lib/dates";
import { getDb } from "@/lib/db";

/**
 * Operational records belong to the post's history. Lifeguards read the
 * records of the posts they are assigned to; coordinators their area;
 * authority and administrators all.
 */

const versionFields = {
  id: true,
  version: true,
  name: true,
  description: true,
  active: true,
  fields: true,
  createdAt: true,
  createdBy: { select: { name: true } },
} as const;

function parseVersion<T extends { fields: Prisma.JsonValue }>(version: T) {
  return { ...version, fields: fieldsSchema.parse(version.fields) };
}

/** Current version of each category. Active only, unless `all`. */
export async function listCategories(all = false) {
  const categories = await getDb().occurrenceCategory.findMany({
    select: {
      id: true,
      versions: { select: versionFields, orderBy: { version: "desc" } },
    },
  });
  return categories
    .filter((category) => category.versions.length > 0)
    .map((category) => ({
      id: category.id,
      current: parseVersion(category.versions[0]!),
      versions: category.versions.map(parseVersion),
    }))
    .filter((category) => all || category.current.active)
    .sort((a, b) => a.current.name.localeCompare(b.current.name));
}

export async function listCategoriesForAdmin(actor: Actor) {
  if (!canManageOccurrenceCategories(actor)) return null;
  return listCategories(true);
}

export type OccurrenceFilters = {
  from: string;
  to: string;
  postId?: string;
  categoryId?: string;
};

function postWhere(
  actor: Actor,
  postId?: string,
): Prisma.OccurrenceWhereInput | null {
  if (canViewAvailability(actor)) {
    const posts = postScope(actor, postId);
    return posts ? { postId: posts } : {};
  }
  if (actor.role === "LIFEGUARD") {
    const allowed = postId
      ? actor.assignedPostIds.filter((id) => id === postId)
      : [...actor.assignedPostIds];
    return { postId: { in: allowed } };
  }
  return null;
}

export async function listOccurrences(
  actor: Actor,
  filters: OccurrenceFilters,
) {
  const where = postWhere(actor, filters.postId);
  if (!where) return null;
  const records = await getDb().occurrence.findMany({
    where: {
      ...where,
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      occurredAt: operationalRange(filters.from, filters.to),
    },
    select: {
      id: true,
      occurredAt: true,
      recordedAt: true,
      description: true,
      values: true,
      post: { select: { code: true, name: true } },
      author: { select: { name: true } },
      categoryVersion: { select: { name: true, fields: true } },
      annulment: { select: { reason: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 300,
  });
  return records.map((record) => ({
    ...record,
    categoryVersion: parseVersion(record.categoryVersion),
    values: (record.values ?? {}) as Record<
      string,
      string | number | boolean | null
    >,
  }));
}

export async function getOccurrenceForActor(actor: Actor, id: string) {
  const db = getDb();
  const record = await db.occurrence.findUnique({
    where: { id },
    select: {
      id: true,
      postId: true,
      authorId: true,
      occurredAt: true,
      recordedAt: true,
      description: true,
      values: true,
      post: { select: { code: true, name: true } },
      author: { select: { name: true } },
      categoryVersion: { select: { name: true, version: true, fields: true } },
      annulment: {
        select: {
          reason: true,
          createdAt: true,
          by: { select: { name: true } },
        },
      },
    },
  });
  if (!record || !canViewOccurrences(actor, record.postId)) return null;
  const audit = await db.auditLog.findMany({
    where: { entityType: "Occurrence", entityId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      action: true,
      before: true,
      after: true,
      reason: true,
      actor: { select: { name: true } },
    },
  });
  return {
    ...record,
    categoryVersion: parseVersion(record.categoryVersion),
    values: (record.values ?? {}) as Record<
      string,
      string | number | boolean | null
    >,
    canAnnul: !record.annulment && canAnnulOccurrence(actor, record),
    audit,
  };
}
