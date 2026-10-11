import { beforeEach, describe, expect, it, vi } from "vitest";

import { actors, POST_A } from "../../../../tests/support/actors";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  createAlert: vi.fn(),
  countUnacknowledged: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/features/alerts/service", () => ({
  createAlert: mocks.createAlert,
}));
vi.mock("@/features/alerts/queries", () => ({
  countUnacknowledged: mocks.countUnacknowledged,
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error },
}));

const { POST } = await import("@/app/api/alertas/route");
const { GET } = await import("@/app/api/alertas/pendentes/route");

const ALERT_ID = "19191919-1919-4191-8191-191919191919";
const body = (extra: Record<string, unknown> = {}) => ({
  id: ALERT_ID,
  postId: POST_A,
  description: "Mar agitado, preciso de reforço",
  deviceTime: "2026-10-12T10:00:00.000Z",
  ...extra,
});

function request(payload: unknown, headers: Record<string, string> = {}) {
  return new Request("http://app.local/api/alertas", {
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

const stored = {
  id: ALERT_ID,
  status: "OPEN",
  createdAt: "2026-10-12T10:00:01.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({
    sessionId: "s",
    actor: actors.captainA,
  });
  mocks.createAlert.mockResolvedValue({
    ok: true,
    created: true,
    alert: stored,
  });
});

describe("POST /api/alertas", () => {
  it("confirms only after the service stored it (201)", async () => {
    const response = await POST(request(body()));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ alert: stored });
    expect(mocks.createAlert).toHaveBeenCalledWith({}, actors.captainA, {
      ...body(),
      deviceTime: new Date("2026-10-12T10:00:00.000Z"),
      allowAnotherActive: false,
    });
  });

  it("answers 200 for a repeated request, without creating", async () => {
    mocks.createAlert.mockResolvedValue({
      ok: true,
      created: false,
      alert: stored,
    });
    expect((await POST(request(body()))).status).toBe(200);
  });

  it("answers 503, never 'sent', when the server cannot store it", async () => {
    mocks.createAlert.mockRejectedValue(new Error("connection refused"));
    const response = await POST(request(body()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
    // The log keeps no alert text.
    expect(JSON.stringify(mocks.error.mock.calls)).not.toMatch(/Mar agitado/);
  });

  it("answers 503 when even the session cannot be read (database down)", async () => {
    mocks.getCurrentSession.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await POST(request(body()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
    expect(mocks.createAlert).not.toHaveBeenCalled();
  });

  it("passes on refusals (duplicate active alert, not captain)", async () => {
    mocks.createAlert.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      code: "ACTIVE_ALERT_EXISTS",
      message: "Já existe um alerta ativo deste posto.",
      activeAlertId: "a1",
    });
    const response = await POST(request(body()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "ACTIVE_ALERT_EXISTS",
      activeAlertId: "a1",
    });
  });

  it("refuses another site before reading the session", async () => {
    expect(
      (await POST(request(body(), { origin: "https://evil.example" }))).status,
    ).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);
    expect((await POST(request(body()))).status).toBe(401);
    expect(mocks.createAlert).not.toHaveBeenCalled();
  });

  it.each([
    ["broken JSON", "{"],
    ["short description", body({ description: "ok" })],
    ["invalid id", body({ id: "x" })],
  ])("rejects %s", async (_label, payload) => {
    expect((await POST(request(payload))).status).toBe(400);
    expect(mocks.createAlert).not.toHaveBeenCalled();
  });
});

describe("GET /api/alertas/pendentes", () => {
  it("counts for the signed-in user only", async () => {
    mocks.getCurrentSession.mockResolvedValue({
      sessionId: "s",
      actor: actors.coordinatorA,
    });
    mocks.countUnacknowledged.mockResolvedValue(2);
    const response = await GET();
    expect(await response.json()).toEqual({ open: 2 });
    expect(mocks.countUnacknowledged).toHaveBeenCalledWith(actors.coordinatorA);
  });

  it("requires a session", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
