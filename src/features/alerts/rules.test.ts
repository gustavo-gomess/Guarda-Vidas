import { describe, expect, it } from "vitest";

import {
  availableActions,
  checkTransition,
  minutesWaiting,
  planCreate,
  targetOf,
  type AlertAction,
  type AlertStatus,
  type TransitionInput,
} from "@/features/alerts/rules";

const STATUSES: AlertStatus[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "CLOSED",
  "CANCELLED",
];

function transition(overrides: Partial<TransitionInput>): string | null {
  const current = overrides.current ?? "OPEN";
  return checkTransition({
    action: "ACKNOWLEDGE",
    expectedStatus: current,
    current,
    note: "Resultado registrado",
    confirmed: true,
    canManage: true,
    isAuthor: false,
    ...overrides,
  });
}

describe("states and allowed transitions", () => {
  it("defines exactly these transitions", () => {
    expect(
      Object.fromEntries(STATUSES.map((s) => [s, availableActions(s)])),
    ).toEqual({
      OPEN: ["ACKNOWLEDGE", "CANCEL"],
      ACKNOWLEDGED: ["START", "CLOSE", "CANCEL"],
      IN_PROGRESS: ["CLOSE", "CANCEL"],
      CLOSED: [],
      CANCELLED: [],
    });
    expect(targetOf("ACKNOWLEDGE")).toBe("ACKNOWLEDGED");
    expect(targetOf("START")).toBe("IN_PROGRESS");
    expect(targetOf("CLOSE")).toBe("CLOSED");
    expect(targetOf("CANCEL")).toBe("CANCELLED");
  });

  it.each([
    ["OPEN", "ACKNOWLEDGE"],
    ["ACKNOWLEDGED", "START"],
    ["ACKNOWLEDGED", "CLOSE"],
    ["IN_PROGRESS", "CLOSE"],
    ["OPEN", "CANCEL"],
    ["IN_PROGRESS", "CANCEL"],
  ] as const)("allows %s → %s", (current, action) => {
    expect(transition({ current, action })).toBeNull();
  });

  it.each([
    ["OPEN", "START"],
    ["OPEN", "CLOSE"],
    ["IN_PROGRESS", "ACKNOWLEDGE"],
    ["CLOSED", "CANCEL"],
    ["CANCELLED", "ACKNOWLEDGE"],
    ["CLOSED", "CLOSE"],
  ] as const)("refuses %s → %s (history is final)", (current, action) => {
    expect(transition({ current, action })).toMatch(/Não é possível/);
  });
});

describe("no accidental or stale actions", () => {
  it("requires explicit confirmation", () => {
    expect(transition({ confirmed: false })).toMatch(/Confirme/);
  });

  it("refuses when the alert changed since the user looked at it", () => {
    // Another coordinator acknowledged it first.
    expect(
      transition({ current: "ACKNOWLEDGED", expectedStatus: "OPEN" }),
    ).toMatch(/mudou para "Reconhecido"/);
  });

  it.each(["CLOSE", "CANCEL"] as AlertAction[])("%s needs a note", (action) => {
    expect(transition({ current: "IN_PROGRESS", action, note: "  " })).toMatch(
      /mínimo de 5/,
    );
  });

  it("acknowledging does not need a note", () => {
    expect(transition({ note: "" })).toBeNull();
  });
});

describe("who acts", () => {
  it("only the coordination acknowledges, attends and closes", () => {
    for (const [current, action] of [
      ["OPEN", "ACKNOWLEDGE"],
      ["ACKNOWLEDGED", "START"],
      ["IN_PROGRESS", "CLOSE"],
    ] as const) {
      expect(
        transition({ current, action, canManage: false, isAuthor: true }),
      ).toMatch(/permissão/);
    }
  });

  it("the author may cancel; others may not", () => {
    expect(
      transition({ action: "CANCEL", canManage: false, isAuthor: true }),
    ).toBeNull();
    expect(
      transition({ action: "CANCEL", canManage: false, isAuthor: false }),
    ).toMatch(/permissão/);
  });
});

describe("creation", () => {
  const base = {
    canCreate: true,
    actorId: "cap",
    existing: null,
    postId: "post-a",
    description: "Mar agitado, preciso de 2 guarda-vidas",
    activeOnPost: null,
    allowAnotherActive: false,
  };

  it("creates for the captain", () => {
    expect(planCreate(base)).toEqual({ type: "create" });
  });

  it("refuses anyone else", () => {
    expect(planCreate({ ...base, canCreate: false })).toMatchObject({
      type: "error",
      httpStatus: 403,
    });
  });

  it("recognizes a repeated request (same id and content)", () => {
    expect(
      planCreate({
        ...base,
        existing: {
          authorId: "cap",
          postId: "post-a",
          description: base.description,
        },
      }),
    ).toEqual({ type: "already-stored" });
  });

  it("never overwrites: same id with other content is refused", () => {
    expect(
      planCreate({
        ...base,
        existing: { authorId: "cap", postId: "post-a", description: "outro" },
      }),
    ).toMatchObject({ type: "error", code: "ID_CONFLICT" });
  });

  it("asks before a second active alert of the same post", () => {
    expect(planCreate({ ...base, activeOnPost: { id: "a1" } })).toMatchObject({
      type: "error",
      httpStatus: 409,
      code: "ACTIVE_ALERT_EXISTS",
      activeAlertId: "a1",
    });
    expect(
      planCreate({
        ...base,
        activeOnPost: { id: "a1" },
        allowAnotherActive: true,
      }),
    ).toEqual({ type: "create" });
  });
});

describe("waiting time", () => {
  it("counts whole minutes, never negative", () => {
    const created = new Date("2026-10-12T10:00:00Z");
    expect(minutesWaiting(created, new Date("2026-10-12T10:07:59Z"))).toBe(7);
    expect(minutesWaiting(created, new Date("2026-10-12T09:59:00Z"))).toBe(0);
  });
});
