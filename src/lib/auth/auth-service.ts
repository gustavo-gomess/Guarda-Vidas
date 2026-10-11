import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";

/**
 * Login and session rules, independent of Next.js and Prisma so they can be
 * tested with an in-memory store. Time is always passed in (`now`).
 *
 * Provisional values (docs/OPEN-DECISIONS.md, OD-22): sessions expire after
 * 7 days without use and 30 days after login at most; 5 consecutive wrong
 * passwords lock the account for 15 minutes.
 */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type LoginUser = {
  id: string;
  active: boolean;
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
};

export type StoredSession = {
  id: string;
  userId: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  userActive: boolean;
};

export interface AuthStore {
  findUserForLogin(username: string): Promise<LoginUser | null>;
  recordFailedLogin(
    userId: string,
    failedLoginAttempts: number,
    lockedUntil: Date | null,
  ): Promise<void>;
  /** Clears the failure counter; replaces the hash when given (rehash). */
  recordSuccessfulLogin(
    userId: string,
    newPasswordHash?: string,
  ): Promise<void>;
  createSession(session: Omit<StoredSession, "userActive">): Promise<void>;
  findSession(id: string): Promise<StoredSession | null>;
  extendSession(id: string, expiresAt: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteUserSessions(userId: string, exceptSessionId?: string): Promise<void>;
}

export type AuthFailureReason = "invalid" | "inactive" | "locked";

export type AuthResult =
  | { ok: true; userId: string; mustChangePassword: boolean }
  | { ok: false; reason: AuthFailureReason; userId?: string };

/** One message for every failure, so it does not reveal which accounts exist. */
export const LOGIN_FAILED_MESSAGE =
  "Não foi possível entrar. Confira usuário e senha ou aguarde alguns minutos.";

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

let dummyHash: Promise<string> | undefined;

/** Same cost as a real check, so response time does not reveal accounts. */
async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
}

export async function authenticate(
  store: AuthStore,
  credentials: { username: string; password: string },
  now: Date,
): Promise<AuthResult> {
  const user = await store.findUserForLogin(
    normalizeUsername(credentials.username),
  );

  if (!user) {
    await burnPasswordCheck(credentials.password);
    return { ok: false, reason: "invalid" };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await burnPasswordCheck(credentials.password);
    return { ok: false, reason: "locked", userId: user.id };
  }

  const valid = await verifyPassword(credentials.password, user.passwordHash);

  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_LOGINS;
    await store.recordFailedLogin(
      user.id,
      lock ? 0 : attempts,
      lock ? new Date(now.getTime() + LOCKOUT_MS) : null,
    );
    return { ok: false, reason: lock ? "locked" : "invalid", userId: user.id };
  }

  // Checked after the password so an attacker cannot probe active status.
  if (!user.active) {
    return { ok: false, reason: "inactive", userId: user.id };
  }

  await store.recordSuccessfulLogin(
    user.id,
    needsRehash(user.passwordHash)
      ? await hashPassword(credentials.password)
      : undefined,
  );
  return {
    ok: true,
    userId: user.id,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function startSession(
  store: AuthStore,
  userId: string,
  now: Date,
): Promise<{ token: string; absoluteExpiresAt: Date }> {
  const token = generateSessionToken();
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await store.createSession({
    id: hashSessionToken(token),
    userId,
    expiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    absoluteExpiresAt,
  });
  return { token, absoluteExpiresAt };
}

export type ValidSession = { sessionId: string; userId: string };

/**
 * Returns the session for a token, or null when it is unknown, expired or
 * belongs to an inactive user. Expired sessions are deleted. Active ones
 * are extended (sliding idle expiry, capped by the absolute expiry).
 */
export async function validateSession(
  store: AuthStore,
  token: string,
  now: Date,
): Promise<ValidSession | null> {
  if (!token) return null;
  const id = hashSessionToken(token);
  const session = await store.findSession(id);
  if (!session) return null;

  if (
    session.expiresAt <= now ||
    session.absoluteExpiresAt <= now ||
    !session.userActive
  ) {
    await store.deleteSession(id);
    return null;
  }

  // Write at most about once per half idle period, not on every request.
  if (session.expiresAt.getTime() - now.getTime() < SESSION_IDLE_MS / 2) {
    const extended = Math.min(
      now.getTime() + SESSION_IDLE_MS,
      session.absoluteExpiresAt.getTime(),
    );
    await store.extendSession(id, new Date(extended));
  }

  return { sessionId: id, userId: session.userId };
}

export async function endSession(
  store: AuthStore,
  token: string,
): Promise<void> {
  if (token) await store.deleteSession(hashSessionToken(token));
}
