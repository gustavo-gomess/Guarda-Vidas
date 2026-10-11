import { afterEach, describe, expect, it, vi } from "vitest";

import { sendRegistration } from "@/features/attendance/client/device";
import type { RegistrationPayload } from "@/features/attendance/schemas";

const payload: RegistrationPayload = {
  id: "12121212-1212-4121-8121-121212121212",
  userId: "33333333-3333-4333-8333-333333333333",
  kind: "CHECK_IN",
  mode: "online",
  deviceTime: "2026-10-12T10:00:00.000Z",
  clockOffsetMs: null,
  postId: "11111111-1111-4111-8111-111111111111",
  location: { status: "DENIED" },
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the device concludes from the server's answer", () => {
  it("is 'stored' only with a real confirmation", async () => {
    answer(201, {
      record: {
        id: payload.id,
        status: "VALIDATED",
        effectiveTime: "2026-10-12T10:00:05.000Z",
      },
    });
    expect(await sendRegistration(payload)).toEqual({
      kind: "stored",
      status: "VALIDATED",
      effectiveTime: "2026-10-12T10:00:05.000Z",
    });
  });

  it("treats no answer as a network failure (record kept)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await sendRegistration(payload)).toEqual({ kind: "network" });
  });

  it("treats a non-JSON answer (captive portal, proxy) as a network failure", async () => {
    answer(200, "<html>Wi-Fi login</html>");
    expect(await sendRegistration(payload)).toEqual({ kind: "network" });
  });

  it("does not trust a 200 without a record", async () => {
    answer(200, { ok: true });
    expect((await sendRegistration(payload)).kind).not.toBe("stored");
  });

  it("maps an expired session", async () => {
    answer(401, { code: "UNAUTHENTICATED" });
    expect(await sendRegistration(payload)).toEqual({
      kind: "unauthenticated",
    });
  });

  it.each([
    [409, "WRONG_USER"],
    [403, "PASSWORD_CHANGE"],
    [500, "ERROR"],
  ])("keeps the record for later on %i %s", async (status, code) => {
    answer(status, { code, message: "m" });
    expect(await sendRegistration(payload)).toEqual({
      kind: "retry-later",
      message: "m",
    });
  });

  it("reports a definitive refusal with the server's message", async () => {
    answer(409, {
      code: "ALREADY_CHECKED_IN",
      message: "Entrada já registrada hoje às 08:00.",
    });
    expect(await sendRegistration(payload)).toEqual({
      kind: "refused",
      message: "Entrada já registrada hoje às 08:00.",
    });
  });
});
