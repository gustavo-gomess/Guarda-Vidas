import "server-only";

import {
  canChangePostStatus,
  canManagePosts,
  canManagePostTeam,
  canViewAllPosts,
  canViewPost,
  type Actor,
} from "@/lib/auth/policy";
import { getDb } from "@/lib/db";

/**
 * Data access for posts. Each function checks the policy with the Actor, so
 * changing a post id in the URL cannot reveal another post.
 */

/** Posts the actor may see. */
export async function listVisiblePosts(actor: Actor) {
  const ids = [...actor.coordinatedPostIds, ...actor.assignedPostIds];
  return getDb().post.findMany({
    where: canViewAllPosts(actor) ? {} : { id: { in: ids } },
    select: { id: true, code: true, name: true, location: true, status: true },
    // Enum order: operating, suspended, inactive.
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

/** Null when the post does not exist or the actor may not see it. */
export async function getPostForActor(actor: Actor, postId: string) {
  if (!canViewPost(actor, postId)) return null;

  const post = await getDb().post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      code: true,
      name: true,
      location: true,
      notes: true,
      status: true,
      latitude: true,
      longitude: true,
      proximityRadiusMeters: true,
      coordinators: {
        select: { user: { select: { id: true, name: true } } },
        orderBy: { user: { name: "asc" } },
      },
      assignments: {
        select: {
          isCaptain: true,
          user: { select: { id: true, name: true, active: true } },
        },
        orderBy: { user: { name: "asc" } },
      },
    },
  });
  if (!post) return null;

  return {
    ...post,
    canManageTeam: canManagePostTeam(actor, postId),
    canManageCoordinators: canManagePosts(actor),
    canEditPost: canManagePosts(actor),
    canChangeStatus: canChangePostStatus(actor, postId),
  };
}

/** Candidates for the team and coordinator pickers on a post page. */
export async function listAssignableUsers(actor: Actor, postId: string) {
  if (!canManagePostTeam(actor, postId)) return null;
  const db = getDb();
  const [lifeguards, coordinators] = await Promise.all([
    db.user.findMany({
      where: {
        role: "LIFEGUARD",
        active: true,
        assignments: { none: { postId } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    canManagePosts(actor)
      ? db.user.findMany({
          where: {
            role: "COORDINATOR",
            active: true,
            coordinatedPosts: { none: { postId } },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);
  return { lifeguards, coordinators };
}

export async function listPostAuditForActor(actor: Actor, postId: string) {
  if (!canManagePostTeam(actor, postId) && actor.role !== "AUTHORITY") {
    return null;
  }
  return getDb().auditLog.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      action: true,
      entityId: true,
      before: true,
      after: true,
      reason: true,
      actor: { select: { name: true } },
    },
  });
}
