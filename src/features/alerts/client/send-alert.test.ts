import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAlert } from "@/features/alerts/client/send-alert";

const payload = {
  id: "19191919-1919-4191-8191-191919191919",
  postId: "11111111-1111-4111-8111-111111111111",
  description: "Mar agitado",
  deviceTime: "2026-10-12T10:00:00.000Z",
};

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      typeof body === "string"
        ? new Response(body, { status })
        : Response.json(body, { status }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("what the screen concludes (never 'sent' without the server)", () => {
  it("stored only with the alert in the answer", async () => {
    const alert = {
      id: payload.id,
      status: "OPEN",
      createdAt: "2026-10-12T10:00:01Z",
    };
    answer(201, { alert });
    expect(await sendAlert(payload)).toEqual({
      kind: "stored",
      created: true,
      alert,
    });
  });

  it("network failure: not sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await sendAlert(payload)).toEqual({
      kind: "not-sent",
      reason: "network",
    });
  });

  it("server unavailable: not sent", async () => {
    answer(503, { code: "UNAVAILABLE", message: "x" });
    expect(await sendAlert(payload)).toEqual({
      kind: "not-sent",
      reason: "server",
    });
    answer(502, "<html>Bad gateway</html>");
    expect(await sendAlert(payload)).toEqual({
      kind: "not-sent",
      reason: "server",
    });
    // Empty body, as when the server crashes before answering.
    answer(500, "");
    expect(await sendAlert(payload)).toEqual({
      kind: "not-sent",
      reason: "server",
    });
    // A captive portal page with 200 is not a confirmation either.
    answer(200, "<html>Wi-Fi</html>");
    expect(await sendAlert(payload)).toEqual({
      kind: "not-sent",
      reason: "network",
    });
  });

  it("a 200 without the alert is not a confirmation", async () => {
    answer(200, { ok: true });
    expect((await sendAlert(payload)).kind).toBe("not-sent");
  });

  it("expired session: not sent", async () => {
    answer(401, { code: "UNAUTHENTICATED" });
    expect(await sendAlert(payload)).toEqual({
      kind: "not-sent",
      reason: "session",
    });
  });

  it("a refusal keeps the server's reason", async () => {
    answer(409, {
      code: "ACTIVE_ALERT_EXISTS",
      message: "Já existe",
      activeAlertId: "a1",
    });
    expect(await sendAlert(payload)).toEqual({
      kind: "refused",
      code: "ACTIVE_ALERT_EXISTS",
      message: "Já existe",
      activeAlertId: "a1",
    });
  });
});
