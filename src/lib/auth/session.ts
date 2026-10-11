import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { getEnv } from "@/env";
import {
  endSession,
  startSession,
  validateSession,
} from "@/lib/auth/auth-service";
import type { Actor } from "@/lib/auth/policy";
import { createPrismaAuthStore } from "@/lib/auth/prisma-auth-store";
import { getDb } from "@/lib/db";

/**
 * Session glue for Next.js: cookie handling and the current Actor.
 *
 * The session is read on every request and never cached across requests,
 * so deactivating a user or signing out takes effect immediately.
 * React `cache` only deduplicates reads within one request.
 */

function cookieName(): string {
  // The __Host- prefix makes the browser refuse the cookie unless it is
  // Secure, has Path=/ and no Domain. Plain name over http in development.
  return getEnv().NODE_ENV === "production"
    ? "__Host-gv_session"
    : "gv_session";
}

export function getAuthStore() {
  return createPrismaAuthStore(getDb());
}

export async function setSessionCookie(userId: string): Promise<void> {
  const { token, absoluteExpiresAt } = await startSession(
    getAuthStore(),
    userId,
    new Date(),
  );
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: absoluteExpiresAt,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  if (token) await endSession(getAuthStore(), token);
  jar.delete(cookieName());
}

async function loadActor(userId: string): Promise<Actor | null> {
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      isAdmin: true,
      active: true,
      mustChangePassword: true,
      coordinatedPosts: { select: { postId: true } },
      assignments: { select: { postId: true, isCaptain: true } },
    },
  });
  if (!user || !user.active) return null;

  // Assignments that do not match the role are ignored, never trusted.
  const isCoordinator = user.role === "COORDINATOR";
  const isLifeguard = user.role === "LIFEGUARD";
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    isAdmin: user.isAdmin && user.role !== "LIFEGUARD",
    mustChangePassword: user.mustChangePassword,
    coordinatedPostIds: isCoordinator
      ? user.coordinatedPosts.map((entry) => entry.postId)
      : [],
    assignedPostIds: isLifeguard
      ? user.assignments.map((entry) => entry.postId)
      : [],
    captainPostIds: isLifeguard
      ? user.assignments
          .filter((entry) => entry.isCaptain)
          .map((entry) => entry.postId)
      : [],
  };
}

type CurrentSession = { sessionId: string; actor: Actor };

/** The signed-in user for this request, or null. Never throws for auth. */
export const getCurrentSession = cache(
  async (): Promise<CurrentSession | null> => {
    // Request time only: keeps the session (and the clock used to check
    // expiry) out of every prerender, including per-session prefetches.
    await connection();
    const token = (await cookies()).get(cookieName())?.value;
    if (!token) return null;
    const session = await validateSession(getAuthStore(), token, new Date());
    if (!session) return null;
    const actor = await loadActor(session.userId);
    return actor ? { sessionId: session.sessionId, actor } : null;
  },
);

type RequireOptions = {
  /** Allow users who still have a temporary password (the change page). */
  allowPendingPasswordChange?: boolean;
};

/**
 * For pages and Server Actions: returns the Actor or redirects to /login.
 * Users with a temporary password are sent to /conta/senha.
 */
export async function requireActor(
  options: RequireOptions = {},
): Promise<Actor> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.actor.mustChangePassword && !options.allowPendingPasswordChange) {
    redirect("/conta/senha");
  }
  return session.actor;
}
