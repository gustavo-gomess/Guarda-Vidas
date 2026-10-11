import { beforeEach, describe, expect, it, vi } from "vitest";

import { actors, POST_A } from "../../../../../tests/support/actors";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  registerAttendance: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/features/attendance/service", () => ({
  registerAttendance: mocks.registerAttendance,
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.info,
    warn: mocks.warn,
    error: vi.fn(),
  },
}));

const { POST } = await import("@/app/api/presenca/registros/route");

const RECORD_ID = "12121212-1212-4121-8121-121212121212";

function body(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    userId: actors.lifeguardA.id,
    kind: "CHECK_IN",
    mode: "offline",
    deviceTime: "2026-10-12T10:00:00.000Z",
    clockOffsetMs: 500,
    postId: POST_A,
    location: {
      status: "CAPTURED",
      latitude: -27.5,
      longitude: -48.5,
      accuracyMeters: 12,
    },
    ...overrides,
  };
}

function request(
  payload: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://app.local/api/presenca/registros", {
    method: "POST",
    headers: {
      host: "app.local",
      origin: "http://app.local",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const storedRecord = {
  id: RECORD_ID,
  kind: "CHECK_IN",
  origin: "OFFLINE",
  status: "AWAITING_VALIDATION",
  effectiveTime: "2026-10-12T10:00:00.000Z",
  receivedAt: "2026-10-12T13:00:00.000Z",
  flags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({
    sessionId: "s",
    actor: actors.lifeguardA,
  });
  mocks.registerAttendance.mockResolvedValue({
    ok: true,
    created: true,
    record: storedRecord,
  });
});

describe("POST /api/presenca/registros", () => {
  it("stores a record for the signed-in user and confirms it", async () => {
    const response = await POST(request(body()));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ record: storedRecord });
    const [, actor, input] = mocks.registerAttendance.mock.calls[0]!;
    expect(actor).toBe(actors.lifeguardA);
    expect(input.deviceTime).toEqual(new Date("2026-10-12T10:00:00.000Z"));
  });

  it("answers 200 for a repeated record (nothing created)", async () => {
    mocks.registerAttendance.mockResolvedValue({
      ok: true,
      created: false,
      record: storedRecord,
    });
    expect((await POST(request(body()))).status).toBe(200);
  });

  it("refuses another site (cross-origin) before reading the session", async () => {
    const response = await POST(
      request(body(), { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.registerAttendance).not.toHaveBeenCalled();
  });

  it("refuses requests without an Origin header or not JSON", async () => {
    const noOrigin = new Request("http://app.local/api/presenca/registros", {
      method: "POST",
      headers: { host: "app.local", "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(
      (await POST(request("x", { "content-type": "text/plain" }))).status,
    ).toBe(415);
  });

  it("answers 401 without a session, so the device keeps the record", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);
    const response = await POST(request(body()));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("refuses users with a temporary password", async () => {
    mocks.getCurrentSession.mockResolvedValue({
      sessionId: "s",
      actor: { ...actors.lifeguardA, mustChangePassword: true },
    });
    expect((await POST(request(body()))).status).toBe(403);
  });

  it.each([
    ["broken JSON", "{"],
    ["invalid id", body({ id: "abc" })],
    ["invalid date", body({ deviceTime: "ontem" })],
    [
      "captured without coordinates",
      body({ location: { status: "CAPTURED" } }),
    ],
    ["unknown kind", body({ kind: "BREAK" })],
  ])("rejects %s", async (_label, payload) => {
    expect((await POST(request(payload))).status).toBe(400);
    expect(mocks.registerAttendance).not.toHaveBeenCalled();
  });

  it("refuses oversized bodies", async () => {
    const huge = JSON.stringify(body({ padding: "x".repeat(9000) }));
    expect((await POST(request(huge))).status).toBe(413);
  });

  it("passes on the rule's refusal with its status", async () => {
    mocks.registerAttendance.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      code: "ALREADY_CHECKED_IN",
      message: "Entrada já registrada hoje às 08:00.",
    });
    const response = await POST(request(body()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "ALREADY_CHECKED_IN",
      message: "Entrada já registrada hoje às 08:00.",
    });
  });

  it("never logs coordinates", async () => {
    await POST(request(body()));
    const logged = JSON.stringify([
      ...mocks.info.mock.calls,
      ...mocks.warn.mock.calls,
    ]);
    expect(logged).not.toMatch(/-27\.5|-48\.5|latitude|longitude/);
  });
});
