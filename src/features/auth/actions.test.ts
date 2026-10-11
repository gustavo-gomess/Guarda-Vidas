import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { MemoryAuthStore } from "../../../tests/support/memory-auth-store";
import { form } from "../../../tests/support/actors";

const PASSWORD = "Senha-Secreta-987";

const mocks = vi.hoisted(() => ({
  store: undefined as unknown as MemoryAuthStore,
  setSessionCookie: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthStore: () => mocks.store,
  setSessionCookie: mocks.setSessionCookie,
  clearSession: vi.fn(),
  getCurrentSession: vi.fn(),
  requireActor: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { loginAction } = await import("@/features/auth/actions");

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store = new MemoryAuthStore();
  mocks.store.addUser({
    id: "u1",
    username: "ana.silva",
    active: true,
    passwordHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: false,
  });
});

function allLogs(): string {
  return JSON.stringify(
    Object.values(mocks.log).flatMap((fn) => fn.mock.calls),
  );
}

describe("loginAction", () => {
  it("signs in and redirects home", async () => {
    await expect(
      loginAction(null, form({ username: "ana.silva", password: PASSWORD })),
    ).rejects.toThrow("REDIRECT:/");
    expect(mocks.setSessionCookie).toHaveBeenCalledWith("u1");
  });

  it("sends users with a temporary password to the change page", async () => {
    mocks.store.user("u1").mustChangePassword = true;
    await expect(
      loginAction(null, form({ username: "ana.silva", password: PASSWORD })),
    ).rejects.toThrow("REDIRECT:/conta/senha");
  });

  it.each([
    ["wrong password", { username: "ana.silva", password: "Senha-Errada-000" }],
    ["unknown user", { username: "fulano", password: PASSWORD }],
  ])("fails with one generic message for a %s", async (_label, values) => {
    const result = await loginAction(null, form(values));
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/Não foi possível entrar/),
    });
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it("refuses an inactive user with the same message", async () => {
    mocks.store.user("u1").active = false;
    const result = await loginAction(
      null,
      form({ username: "ana.silva", password: PASSWORD }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it("never logs passwords or attempted usernames", async () => {
    await loginAction(
      null,
      form({ username: "ana.silva", password: "Senha-Errada-000" }),
    );
    await loginAction(
      null,
      form({ username: "digitou.errado", password: PASSWORD }),
    );
    await loginAction(
      null,
      form({ username: "ana.silva", password: PASSWORD }),
    ).catch(() => undefined);

    const logs = allLogs();
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain("Senha-Errada-000");
    expect(logs).not.toContain("digitou.errado");
    expect(logs).not.toContain(passwordHash);
    expect(logs).toContain("auth.login failed");
    expect(logs).toContain("auth.login succeeded");
  });
});
