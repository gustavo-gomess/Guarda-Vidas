import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  authenticate,
  endSession,
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  startSession,
  validateSession,
} from "@/lib/auth/auth-service";
import { hashPassword } from "@/lib/auth/password";
import { hashSessionToken } from "@/lib/auth/tokens";
import { MemoryAuthStore } from "../../../tests/support/memory-auth-store";

const PASSWORD = "senha-correta-123";
const T0 = new Date("2026-01-10T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

let passwordHash: string;
let store: MemoryAuthStore;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  store = new MemoryAuthStore();
  store.addUser({
    id: "u1",
    username: "ana",
    active: true,
    passwordHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: false,
  });
});

describe("login", () => {
  it("accepts the correct password, ignoring username case and spaces", async () => {
    const result = await authenticate(
      store,
      { username: "  ANA ", password: PASSWORD },
      T0,
    );
    expect(result).toEqual({
      ok: true,
      userId: "u1",
      mustChangePassword: false,
    });
  });

  it("reports a pending password change", async () => {
    store.user("u1").mustChangePassword = true;
    const result = await authenticate(
      store,
      { username: "ana", password: PASSWORD },
      T0,
    );
    expect(result).toMatchObject({ ok: true, mustChangePassword: true });
  });

  it("rejects a wrong password and counts the failure", async () => {
    const result = await authenticate(
      store,
      { username: "ana", password: "errada" },
      T0,
    );
    expect(result).toEqual({ ok: false, reason: "invalid", userId: "u1" });
    expect(store.user("u1").failedLoginAttempts).toBe(1);
  });

  it("rejects an unknown user the same way", async () => {
    const result = await authenticate(
      store,
      { username: "ninguem", password: PASSWORD },
      T0,
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not let inactive users start a session", async () => {
    store.user("u1").active = false;
    const result = await authenticate(
      store,
      { username: "ana", password: PASSWORD },
      T0,
    );
    expect(result).toMatchObject({ ok: false, reason: "inactive" });
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} wrong passwords`, async () => {
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      const attempt = await authenticate(
        store,
        { username: "ana", password: "x" },
        T0,
      );
      expect(attempt).toMatchObject({ reason: "invalid" });
    }
    const last = await authenticate(
      store,
      { username: "ana", password: "x" },
      T0,
    );
    expect(last).toMatchObject({ ok: false, reason: "locked" });

    // Even the right password is refused while locked.
    const during = await authenticate(
      store,
      { username: "ana", password: PASSWORD },
      later(LOCKOUT_MS - 1000),
    );
    expect(during).toMatchObject({ ok: false, reason: "locked" });

    // And accepted after the lock expires, which also clears the counter.
    const after = await authenticate(
      store,
      { username: "ana", password: PASSWORD },
      later(LOCKOUT_MS + 1000),
    );
    expect(after).toMatchObject({ ok: true });
    expect(store.user("u1").failedLoginAttempts).toBe(0);
    expect(store.user("u1").lockedUntil).toBeNull();
  });

  it("upgrades old password hashes on successful login", async () => {
    // A real hash made with older, weaker parameters.
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const key = scryptSync(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1 });
    store.user("u1").passwordHash =
      `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;

    const result = await authenticate(
      store,
      { username: "ana", password: PASSWORD },
      T0,
    );
    expect(result.ok).toBe(true);
    expect(store.user("u1").passwordHash).toMatch(/^scrypt\$32768\$8\$3\$/);
  });
});

describe("sessions", () => {
  it("stores only the token hash, never the token", async () => {
    const { token } = await startSession(store, "u1", T0);
    expect(store.sessions.has(token)).toBe(false);
    expect(store.sessions.has(hashSessionToken(token))).toBe(true);
  });

  it("validates a fresh session", async () => {
    const { token } = await startSession(store, "u1", T0);
    expect(await validateSession(store, token, later(1000))).toEqual({
      sessionId: hashSessionToken(token),
      userId: "u1",
    });
  });

  it("rejects unknown or empty tokens", async () => {
    expect(await validateSession(store, "", T0)).toBeNull();
    expect(await validateSession(store, "forged-token", T0)).toBeNull();
  });

  it("expires after the idle period and deletes the session", async () => {
    const { token } = await startSession(store, "u1", T0);
    expect(
      await validateSession(store, token, later(SESSION_IDLE_MS + 1)),
    ).toBeNull();
    expect(store.sessions.size).toBe(0);
  });

  it("slides the idle expiry while in use, up to the absolute limit", async () => {
    const { token } = await startSession(store, "u1", T0);
    const id = hashSessionToken(token);

    // Use it every 4 days: each use extends it, so it survives past 7 days.
    let now = T0;
    while (
      now.getTime() + 4 * 24 * 3600_000 <
      T0.getTime() + SESSION_ABSOLUTE_MS
    ) {
      now = new Date(now.getTime() + 4 * 24 * 3600_000);
      expect(await validateSession(store, token, now)).not.toBeNull();
      expect(store.sessions.get(id)!.expiresAt.getTime()).toBeLessThanOrEqual(
        T0.getTime() + SESSION_ABSOLUTE_MS,
      );
    }

    // The absolute limit still ends it, no matter how often it is used.
    expect(
      await validateSession(store, token, later(SESSION_ABSOLUTE_MS)),
    ).toBeNull();
  });

  it("is rejected as soon as the user is deactivated", async () => {
    const { token } = await startSession(store, "u1", T0);
    store.user("u1").active = false;
    expect(await validateSession(store, token, later(1000))).toBeNull();
    expect(store.sessions.size).toBe(0);
  });

  it("ends on logout", async () => {
    const { token } = await startSession(store, "u1", T0);
    await endSession(store, token);
    expect(await validateSession(store, token, later(1000))).toBeNull();
  });
});
