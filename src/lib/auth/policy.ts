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
 *
 * Schedules (provisional, OD-08, OD-24..OD-27):
 * - Any COORDINATOR opens and closes availability windows (they are shared).
 * - Only LIFEGUARDs send availability, always for themselves.
 * - Only the post's COORDINATOR builds, confirms and changes its schedule.
 *   Being an administrator does not grant this (operation, not accounts).
 * - LIFEGUARDs see only their own entries in published schedules.
 *
 * Presence (provisional, OD-28..OD-31):
 * - Only LIFEGUARDs register entry and exit, always for themselves.
 * - Only the post's COORDINATOR validates, rejects or sends to review.
 * - Authority and administrators consult; lifeguards see their own.
 *
 * Checklists (provisional, OD-32..OD-35):
 * - The post's COORDINATOR edits the post's item list.
 * - Only the LIFEGUARD of the assumption fills and corrects its checklist.
 * - Coordinators (area), authority and administrators consult.
 *
 * Occurrences and reinforcement alerts (provisional, OD-36..OD-40):
 * - Lifeguards of the post's team register occurrences; administrators
 *   configure the categories and fields.
 * - The post's captain sends reinforcement alerts; the post's coordinators
 *   acknowledge, attend and close them; author or coordinator cancels.
 *
 * Panels and daily closing (provisional, OD-14, OD-15, OD-17):
 * - Coordinators see their area; authority and administrators see all,
 *   read-only; lifeguards see only their own panel.
 * - Only the post's coordinator saves, sends, consolidates and corrects
 *   the post's daily closing.
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

/** Change the operational state of a post (operating, suspended...). */
export function canChangePostStatus(actor: Actor, postId: string): boolean {
  return canManagePostTeam(actor, postId);
}

/** Open and close the shared availability windows. */
export function canManageAvailabilityWindows(actor: Actor): boolean {
  return actor.role === "COORDINATOR";
}

/** Send one's own availability. The user id always comes from the session. */
export function canSubmitAvailability(actor: Actor): boolean {
  return actor.role === "LIFEGUARD";
}

/**
 * See the availability sent by lifeguards. Coordinators are further limited
 * to the teams of their posts by the queries.
 */
export function canViewAvailability(actor: Actor): boolean {
  return actor.role === "COORDINATOR" || actor.role === "AUTHORITY";
}

/** Build, confirm and change the schedule of a post. */
export function canManageSchedule(actor: Actor, postId: string): boolean {
  return coordinates(actor, postId);
}

/** See whole schedules of a post, in any state (read-only for most). */
export function canViewPostSchedules(actor: Actor, postId: string): boolean {
  return canViewAllPosts(actor) || coordinates(actor, postId);
}

/** Register one's own entry and exit. */
export function canRegisterAttendance(actor: Actor): boolean {
  return actor.role === "LIFEGUARD";
}

/** Validate, reject or send to review the presence records of a post. */
export function canValidateAttendance(actor: Actor, postId: string): boolean {
  return coordinates(actor, postId);
}

/** Create, edit, deactivate and reorder the checklist items of a post. */
export function canManageChecklistItems(actor: Actor, postId: string): boolean {
  return coordinates(actor, postId);
}

/** Fill or correct the checklist of a journey: only its own lifeguard. */
export function canFillChecklist(actor: Actor, journeyUserId: string): boolean {
  return actor.role === "LIFEGUARD" && actor.id === journeyUserId;
}

/** Register occurrences and other operational records of a post. */
export function canRecordOccurrence(actor: Actor, postId: string): boolean {
  return actor.role === "LIFEGUARD" && actor.assignedPostIds.includes(postId);
}

/** Read a post's operational records (the post's history). */
export function canViewOccurrences(actor: Actor, postId: string): boolean {
  return canViewPost(actor, postId);
}

/** Annul a record registered by mistake: its author or the coordinator. */
export function canAnnulOccurrence(
  actor: Actor,
  record: { postId: string; authorId: string },
): boolean {
  return (
    (actor.role === "LIFEGUARD" && actor.id === record.authorId) ||
    coordinates(actor, record.postId)
  );
}

/** Configure occurrence categories and their fields (all posts). */
export function canManageOccurrenceCategories(actor: Actor): boolean {
  return actor.isAdmin;
}

/** Send a reinforcement alert from a post. */
export function canCreateAlert(actor: Actor, postId: string): boolean {
  return canActAsCaptain(actor, postId);
}

/** Acknowledge, attend and close the alerts of a post. */
export function canManageAlerts(actor: Actor, postId: string): boolean {
  return coordinates(actor, postId);
}

export function canViewAlert(
  actor: Actor,
  alert: { postId: string; authorId: string },
): boolean {
  return (
    actor.id === alert.authorId ||
    canActAsCaptain(actor, alert.postId) ||
    canViewPostSchedules(actor, alert.postId)
  );
}

/** See consolidated indicators and closings (not lifeguards). */
export function canViewReports(actor: Actor): boolean {
  return canViewAvailability(actor);
}

/** Save, send, consolidate and correct a post's daily closing. */
export function canCloseDay(actor: Actor, postId: string): boolean {
  return coordinates(actor, postId);
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
