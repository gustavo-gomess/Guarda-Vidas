import { describe, expect, it } from "vitest";

import {
  checkDecision,
  classifyTiming,
  distanceMeters,
  estimatedTime,
  evaluateProximity,
  LATE_SYNC_MS,
  planRegistration,
  postFor,
  type RegistrationContext,
  type RegistrationInput,
} from "@/features/attendance/rules";

const NOW = new Date("2026-10-12T13:00:00Z"); // 10:00 in São Paulo
const minutes = (n: number) => n * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const USER = "u-1";
const POST_A = "post-a";
const POST_B = "post-b";

const post = {
  id: POST_A,
  status: "OPERATING",
  latitude: -27.5954,
  longitude: -48.548,
  proximityRadiusMeters: 200,
};
const nearPost = {
  status: "CAPTURED" as const,
  latitude: -27.5956,
  longitude: -48.5482,
  accuracyMeters: 15,
};

function input(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    id: "rec-1",
    userId: USER,
    kind: "CHECK_IN",
    mode: "online",
    deviceTime: NOW,
    clockOffsetMs: 0,
    postId: POST_A,
    location: nearPost,
    ...overrides,
  };
}

function context(
  forInput: RegistrationInput,
  overrides: Partial<RegistrationContext> = {},
): RegistrationContext {
  return {
    actor: { id: USER, role: "LIFEGUARD", assignedPostIds: [POST_A] },
    now: NOW,
    payloadHash: "hash-1",
    existing: null,
    timing: classifyTiming({ ...forInput, now: NOW }),
    scheduledPostId: POST_A,
    post,
    journey: null,
    ...overrides,
  };
}

function plan(
  overridesInput: Partial<RegistrationInput> = {},
  overridesContext: Partial<RegistrationContext> = {},
) {
  const registration = input(overridesInput);
  return planRegistration(
    registration,
    context(registration, overridesContext),
  );
}

describe("time: device clock is information, not proof", () => {
  it("online records use the server time and the São Paulo day", () => {
    const now = new Date("2026-10-13T02:30:00Z"); // 23:30 on the 12th in São Paulo
    const timing = classifyTiming({
      mode: "online",
      deviceTime: new Date(now.getTime() - minutes(1)),
      clockOffsetMs: null,
      now,
    });
    expect(timing).toMatchObject({
      origin: "ONLINE",
      date: "2026-10-12",
      flags: [],
    });
    expect(timing.effectiveTime).toEqual(now);
  });

  it("reports a wrong device clock online, but keeps the server time", () => {
    const timing = classifyTiming({
      mode: "online",
      deviceTime: at(minutes(-40)),
      clockOffsetMs: null,
      now: NOW,
    });
    expect(timing.flags).toEqual(["DEVICE_CLOCK_DIFFERS"]);
    expect(timing.effectiveTime).toEqual(NOW);
  });

  it("offline records keep the declared device time", () => {
    const deviceTime = at(minutes(-90));
    const timing = classifyTiming({
      mode: "offline",
      deviceTime,
      clockOffsetMs: 2000,
      now: NOW,
    });
    expect(timing).toMatchObject({ origin: "OFFLINE", flags: [] });
    expect(timing.effectiveTime).toEqual(deviceTime);
  });

  it("flags a device clock in the future and uses the server day", () => {
    const timing = classifyTiming({
      mode: "offline",
      deviceTime: new Date("2026-10-14T13:00:00Z"),
      clockOffsetMs: 0,
      now: NOW,
    });
    expect(timing.flags).toContain("CLOCK_AHEAD");
    expect(timing.date).toBe("2026-10-12");
  });

  it("flags a known clock error, an unmeasured clock and a late sync", () => {
    expect(
      classifyTiming({
        mode: "offline",
        deviceTime: NOW,
        clockOffsetMs: minutes(30),
        now: NOW,
      }).flags,
    ).toEqual(["CLOCK_SKEW"]);
    expect(
      classifyTiming({
        mode: "offline",
        deviceTime: NOW,
        clockOffsetMs: null,
        now: NOW,
      }).flags,
    ).toEqual(["CLOCK_NOT_MEASURED"]);
    expect(
      classifyTiming({
        mode: "offline",
        deviceTime: at(-LATE_SYNC_MS - 1),
        clockOffsetMs: 0,
        now: NOW,
      }).flags,
    ).toEqual(["LATE_SYNC"]);
  });

  it("estimates the real time for the reviewer when the offset is known", () => {
    expect(estimatedTime(NOW, minutes(3))).toEqual(at(minutes(3)));
    expect(estimatedTime(NOW, null)).toBeNull();
  });
});

describe("location and proximity", () => {
  it("computes distances", () => {
    // About 111 km per degree of latitude.
    const d = distanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it("accepts a point inside the radius", () => {
    expect(evaluateProximity(post, nearPost)).toEqual({
      distanceMeters: expect.any(Number),
      flags: [],
    });
  });

  it("flags out of range only when even the accuracy circle is outside", () => {
    const far = { ...nearPost, latitude: -27.6, longitude: -48.548 }; // ~510 m
    expect(evaluateProximity(post, far).flags).toEqual(["OUT_OF_RANGE"]);
    expect(
      evaluateProximity(post, { ...far, accuracyMeters: 400 }).flags,
    ).toEqual(["LOW_ACCURACY"]);
  });

  it.each(["DENIED", "UNAVAILABLE", "TIMEOUT", "UNSUPPORTED"] as const)(
    "treats a missing location (%s) as a notice, not a refusal",
    (status) => {
      expect(evaluateProximity(post, { status })).toEqual({
        distanceMeters: null,
        flags: ["LOCATION_UNAVAILABLE"],
      });
    },
  );

  it("does not evaluate without approved coordinates and radius", () => {
    expect(
      evaluateProximity({ ...post, proximityRadiusMeters: null }, nearPost)
        .flags,
    ).toEqual(["PROXIMITY_NOT_CONFIGURED"]);
  });
});

describe("entry online", () => {
  it("is accepted with the server time when nothing diverges", () => {
    expect(plan()).toMatchObject({
      type: "create",
      origin: "ONLINE",
      status: "VALIDATED",
      primary: true,
      journeyId: null,
      postId: POST_A,
      flags: [],
    });
  });

  it("is refused when the day already has an entry (no second journey)", () => {
    const result = plan(
      {},
      {
        journey: {
          id: "j-1",
          postId: POST_A,
          checkIn: { status: "VALIDATED", effectiveTime: at(minutes(-60)) },
          checkOut: null,
        },
      },
    );
    expect(result).toMatchObject({
      type: "error",
      httpStatus: 409,
      code: "ALREADY_CHECKED_IN",
    });
  });

  it("goes to review without a confirmed schedule, outside the team or post", () => {
    expect(plan({}, { scheduledPostId: null })).toMatchObject({
      status: "UNDER_REVIEW",
      flags: ["NOT_SCHEDULED"],
    });
    expect(
      plan(
        {},
        { actor: { id: USER, role: "LIFEGUARD", assignedPostIds: [POST_B] } },
      ),
    ).toMatchObject({ status: "UNDER_REVIEW", flags: ["NOT_IN_TEAM"] });
    expect(plan({}, { post: { ...post, status: "SUSPENDED" } })).toMatchObject({
      status: "UNDER_REVIEW",
      flags: ["POST_NOT_OPERATING"],
    });
  });

  it("uses the scheduled post, noting a different choice", () => {
    expect(postFor({ kind: "CHECK_IN", postId: POST_B }, POST_A, null)).toBe(
      POST_A,
    );
    expect(postFor({ kind: "CHECK_IN", postId: POST_B }, null, null)).toBe(
      POST_B,
    );
    expect(plan({ postId: POST_B })).toMatchObject({
      status: "VALIDATED",
      flags: ["POST_DIFFERS"],
    });
  });

  it("goes to review when out of range, and never refuses it", () => {
    const far = { ...nearPost, latitude: -27.61 };
    expect(plan({ location: far })).toMatchObject({
      type: "create",
      status: "UNDER_REVIEW",
      flags: ["OUT_OF_RANGE"],
    });
  });

  it("is accepted without GPS, with a notice", () => {
    expect(plan({ location: { status: "DENIED" } })).toMatchObject({
      status: "VALIDATED",
      flags: ["LOCATION_UNAVAILABLE"],
    });
  });
});

describe("entry offline", () => {
  const offline = { mode: "offline" as const, deviceTime: at(minutes(-120)) };

  it("is stored as provisional, awaiting validation", () => {
    expect(plan(offline)).toMatchObject({
      type: "create",
      origin: "OFFLINE",
      status: "AWAITING_VALIDATION",
      primary: true,
    });
  });

  it("is stored even with divergences, for review", () => {
    expect(
      plan(
        { ...offline, clockOffsetMs: minutes(20) },
        { scheduledPostId: null },
      ),
    ).toMatchObject({
      type: "create",
      status: "UNDER_REVIEW",
      flags: ["CLOCK_SKEW", "NOT_SCHEDULED"],
    });
  });

  it("is preserved as a duplicate when the day already has an entry", () => {
    const result = plan(offline, {
      journey: {
        id: "j-1",
        postId: POST_A,
        checkIn: { status: "VALIDATED", effectiveTime: at(minutes(-60)) },
        checkOut: null,
      },
    });
    expect(result).toMatchObject({
      type: "create",
      journeyId: "j-1",
      primary: false,
      status: "UNDER_REVIEW",
    });
    expect(result.type === "create" && result.flags).toContain("DUPLICATE");
  });
});

describe("repeated synchronization (idempotency)", () => {
  it("returns the stored record for the same id and data", () => {
    expect(
      plan({}, { existing: { userId: USER, payloadHash: "hash-1" } }),
    ).toEqual({
      type: "already-stored",
    });
  });

  it("never overwrites: same id with other data is refused", () => {
    expect(
      plan({}, { existing: { userId: USER, payloadHash: "other" } }),
    ).toMatchObject({
      type: "error",
      code: "PAYLOAD_CONFLICT",
    });
  });

  it("does not reveal or touch another user's record", () => {
    expect(
      plan({}, { existing: { userId: "u-2", payloadHash: "hash-1" } }),
    ).toMatchObject({
      type: "error",
      code: "ID_CONFLICT",
    });
  });
});

describe("permissions and ownership", () => {
  it.each(["COORDINATOR", "AUTHORITY"])("refuses a %s", (role) => {
    expect(
      plan({}, { actor: { id: USER, role, assignedPostIds: [] } }),
    ).toMatchObject({
      type: "error",
      httpStatus: 403,
    });
  });

  it("refuses a record captured for another account on the device", () => {
    expect(plan({ userId: "u-2" })).toMatchObject({
      type: "error",
      code: "WRONG_USER",
    });
  });
});

describe("exit", () => {
  const exit = { kind: "CHECK_OUT" as const, id: "rec-2" };
  const withEntry = (
    status: "VALIDATED" | "REJECTED",
    entryAt = at(minutes(-300)),
  ) => ({
    journey: {
      id: "j-1",
      postId: POST_A,
      checkIn: { status, effectiveTime: entryAt },
      checkOut: null,
    },
  });

  it("is accepted online after an entry, on the journey's post", () => {
    expect(
      plan({ ...exit, postId: POST_B }, withEntry("VALIDATED")),
    ).toMatchObject({
      type: "create",
      journeyId: "j-1",
      postId: POST_A,
      status: "VALIDATED",
      primary: true,
    });
  });

  it("is not accepted offline: no approved rule (OD-10)", () => {
    expect(
      plan({ ...exit, mode: "offline" }, withEntry("VALIDATED")),
    ).toMatchObject({
      type: "error",
      code: "OFFLINE_EXIT_NOT_ALLOWED",
    });
  });

  it("needs an entry and happens once", () => {
    expect(plan(exit)).toMatchObject({ type: "error", code: "NO_CHECK_IN" });
    expect(
      plan(exit, {
        journey: {
          ...withEntry("VALIDATED").journey,
          checkOut: { effectiveTime: at(minutes(-5)) },
        },
      }),
    ).toMatchObject({ type: "error", code: "ALREADY_CHECKED_OUT" });
  });

  it("goes to review after a rejected entry or before the entry time", () => {
    expect(plan(exit, withEntry("REJECTED"))).toMatchObject({
      status: "UNDER_REVIEW",
      flags: ["ENTRY_REJECTED"],
    });
    expect(plan(exit, withEntry("VALIDATED", at(minutes(30))))).toMatchObject({
      status: "UNDER_REVIEW",
      flags: ["EXIT_BEFORE_ENTRY"],
    });
  });
});

describe("coordinator decisions", () => {
  it("validates without justification", () => {
    expect(checkDecision("AWAITING_VALIDATION", "VALIDATED", "")).toBeNull();
    expect(checkDecision("UNDER_REVIEW", "VALIDATED", "")).toBeNull();
  });

  it("requires a justification to reject or keep in review", () => {
    expect(checkDecision("AWAITING_VALIDATION", "REJECTED", "  ")).toMatch(
      /justificativa/,
    );
    expect(
      checkDecision("AWAITING_VALIDATION", "REJECTED", "Não estava no posto"),
    ).toBeNull();
    expect(checkDecision("AWAITING_VALIDATION", "UNDER_REVIEW", "")).toMatch(
      /justificativa/,
    );
  });

  it("requires a justification to revise a final decision", () => {
    expect(checkDecision("REJECTED", "VALIDATED", "")).toMatch(/justificativa/);
    expect(
      checkDecision("VALIDATED", "REJECTED", "Erro de registro"),
    ).toBeNull();
  });

  it("refuses a no-op decision", () => {
    expect(checkDecision("VALIDATED", "VALIDATED", "x")).toMatch(/já está/);
  });
});
