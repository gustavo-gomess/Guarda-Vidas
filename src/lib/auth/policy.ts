/**
 * Authorization rules. Pure functions over an Actor built on the server from
 * the session and the database, never from data sent by the browser.
 *
 * Provisional rules (see docs/OPEN-DECISIONS.md, OD-01, OD-02, OD-04, OD-21):
 * - AUTHORITY reads every post and user, and changes nothing operational.
 * - COORDINATOR acts only on the posts assigned to them (their area).
 * - LIFEGUARD sees their own data and the posts they are assigned to.
 * - Captain is an assignment of a LIFEGUARD to a post, not a role.
 * - isAdmin grants account, post and area administration. Not allowed for
 *   LIFEGUARD.
 */

export type Role = "AUTHORITY" | "COORDINATOR" | "LIFEGUARD";

export type Actor = {
  id: string;
  name: string;
  role: Role;
  isAdmin: boolean;
  mustChangePassword: boolean;
  /** Posts in the coordinator's area (COORDINATOR only). */
  coordinatedPostIds: readonly string[];
  /** Posts the lifeguard is assigned to (LIFEGUARD only). */
  assignedPostIds: readonly string[];
  /** Subset of assignedPostIds where the lifeguard is captain. */
  captainPostIds: readonly string[];
};

/** What the policy needs to know about a user being viewed or changed. */
export type UserTarget = {
  id: string;
  role: Role;
  assignedPostIds: readonly string[];
};

export const ROLE_LABELS: Record<Role, string> = {
  AUTHORITY: "Autoridade superior",
  COORDINATOR: "Coordenador",
  LIFEGUARD: "Guarda-vidas",
};

export function roleAllowsAdmin(role: Role): boolean {
  return role !== "LIFEGUARD";
}

function coordinates(actor: Actor, postId: string): boolean {
  return (
    actor.role === "COORDINATOR" && actor.coordinatedPostIds.includes(postId)
  );
}

/** Create users, change roles, activate/deactivate, reset passwords. */
export function canManageUsers(actor: Actor): boolean {
  return actor.isAdmin;
}

/** Create posts, activate/deactivate them, set coordinator areas. */
export function canManagePosts(actor: Actor): boolean {
  return actor.isAdmin;
}

export function canViewAllPosts(actor: Actor): boolean {
  return actor.isAdmin || actor.role === "AUTHORITY";
}

export function canViewPost(actor: Actor, postId: string): boolean {
  if (canViewAllPosts(actor)) return true;
  if (actor.role === "COORDINATOR") return coordinates(actor, postId);
  return actor.assignedPostIds.includes(postId);
}

/** Assign or remove lifeguards and choose the captain of a post. */
export function canManagePostTeam(actor: Actor, postId: string): boolean {
  return actor.isAdmin || coordinates(actor, postId);
}

/** Captain-only operational duties, e.g. reinforcement alerts. */
export function canActAsCaptain(actor: Actor, postId: string): boolean {
  return actor.role === "LIFEGUARD" && actor.captainPostIds.includes(postId);
}

export function canViewUser(actor: Actor, target: UserTarget): boolean {
  if (actor.id === target.id) return true;
  if (actor.isAdmin || actor.role === "AUTHORITY") return true;
  if (actor.role === "COORDINATOR") {
    return target.assignedPostIds.some((postId) => coordinates(actor, postId));
  }
  return false;
}
