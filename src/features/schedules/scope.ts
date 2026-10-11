import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { canViewAllPosts, type Actor } from "@/lib/auth/policy";

/**
 * Posts whose availability and schedules the actor sees as a manager or
 * reader: every post for authority and administrators, the area for a
 * coordinator, none for a lifeguard (they only see their own data).
 * `undefined` means "all posts".
 */
export function managedPostIds(actor: Actor): readonly string[] | undefined {
  if (canViewAllPosts(actor)) return undefined;
  if (actor.role === "COORDINATOR") return actor.coordinatedPostIds;
  return [];
}

/**
 * Restricts a query to the given post filter within the actor's scope.
 * A post outside the scope yields an empty list, never an error that would
 * confirm the post exists.
 */
export function postScope(
  actor: Actor,
  postId?: string,
): { in: string[] } | undefined {
  const allowed = managedPostIds(actor);
  if (postId) {
    return { in: !allowed || allowed.includes(postId) ? [postId] : [] };
  }
  return allowed ? { in: [...allowed] } : undefined;
}

/** Lifeguards in the actor's scope, optionally of one post. */
export function lifeguardScope(
  actor: Actor,
  postId?: string,
): Prisma.UserWhereInput {
  const posts = postScope(actor, postId);
  return {
    role: "LIFEGUARD",
    ...(posts ? { assignments: { some: { postId: posts } } } : {}),
  };
}
