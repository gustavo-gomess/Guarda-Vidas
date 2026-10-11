import { describe, expect, it } from "vitest";

import {
  availabilityOn,
  checkAddEntry,
  checkConfirm,
  checkOpenWindow,
  checkRemoveEntry,
  checkSubmitAvailability,
  isInWindow,
  isPublished,
  statusAfterChange,
  windowDays,
  type AddEntryInput,
} from "@/features/schedules/rules";

const TODAY = "2026-10-12";

describe("availability windows (periods)", () => {
  it("cover three consecutive days, across month ends", () => {
    expect(windowDays("2026-10-30")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(isInWindow("2026-10-12", "2026-10-14")).toBe(true);
    expect(isInWindow("2026-10-12", "2026-10-15")).toBe(false);
    expect(isInWindow("2026-10-12", "2026-10-11")).toBe(false);
  });

  it("can start today or later", () => {
    const base = { today: TODAY, existingStartDates: [] };
    expect(checkOpenWindow({ ...base, startDate: TODAY })).toBeNull();
    expect(checkOpenWindow({ ...base, startDate: "2026-10-20" })).toBeNull();
    expect(checkOpenWindow({ ...base, startDate: "2026-10-11" })).toMatch(
      /já passou/,
    );
  });

  it("never overlap another window", () => {
    const existing = { today: TODAY, existingStartDates: ["2026-10-15"] };
    for (const start of [
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
    ]) {
      expect(checkOpenWindow({ ...existing, startDate: start })).toMatch(
        /Já existe uma janela/,
      );
    }
    // Back-to-back windows are fine.
    expect(
      checkOpenWindow({ ...existing, startDate: "2026-10-12" }),
    ).toBeNull();
    expect(
      checkOpenWindow({ ...existing, startDate: "2026-10-18" }),
    ).toBeNull();
  });

  it("accept availability only while open", () => {
    expect(checkSubmitAvailability("OPEN")).toBeNull();
    expect(checkSubmitAvailability("CLOSED")).toMatch(/encerrada/);
  });
});

describe("availability answers", () => {
  const sent = { day1: true, day2: false, day3: true };

  it("reads each day of the window", () => {
    expect(availabilityOn(sent, TODAY, "2026-10-12")).toBe("AVAILABLE");
    expect(availabilityOn(sent, TODAY, "2026-10-13")).toBe("UNAVAILABLE");
    expect(availabilityOn(sent, TODAY, "2026-10-14")).toBe("AVAILABLE");
  });

  it("is 'not sent' without a submission or outside the window", () => {
    expect(availabilityOn(null, TODAY, TODAY)).toBe("NOT_SENT");
    expect(availabilityOn(sent, TODAY, "2026-10-15")).toBe("NOT_SENT");
  });
});

const validAdd: AddEntryInput = {
  scheduleStatus: "PROPOSED",
  windowStart: TODAY,
  postStatus: "OPERATING",
  date: "2026-10-13",
  today: TODAY,
  target: { role: "LIFEGUARD", active: true, inTeam: true },
  existing: null,
  availability: "AVAILABLE",
  reason: "",
};

describe("adding a lifeguard to a schedule", () => {
  it("accepts an available team member on a future day of the window", () => {
    expect(checkAddEntry(validAdd)).toBeNull();
  });

  it("refuses a second post on the same day (conflict)", () => {
    expect(
      checkAddEntry({
        ...validAdd,
        existing: { postName: "Posto Norte", samePost: false },
      }),
    ).toBe(
      "Conflito: este guarda-vidas já está escalado no posto Posto Norte neste dia.",
    );
  });

  it("refuses a duplicate on the same post and day", () => {
    expect(
      checkAddEntry({
        ...validAdd,
        existing: { postName: "Posto Sul", samePost: true },
      }),
    ).toMatch(/já está escalado neste posto/);
  });

  it("checks conflicts before the justification", () => {
    expect(
      checkAddEntry({
        ...validAdd,
        scheduleStatus: "CONFIRMED",
        reason: "Justificativa válida",
        existing: { postName: "Posto Norte", samePost: false },
      }),
    ).toMatch(/^Conflito/);
  });

  it.each([
    ["no user", null],
    ["inactive", { role: "LIFEGUARD", active: false, inTeam: true }],
    ["coordinator", { role: "COORDINATOR", active: true, inTeam: true }],
  ])("refuses a target that is not an active lifeguard (%s)", (_l, target) => {
    expect(checkAddEntry({ ...validAdd, target })).toMatch(
      /guarda-vidas ativo/,
    );
  });

  it("refuses someone outside the post's team", () => {
    expect(
      checkAddEntry({
        ...validAdd,
        target: { role: "LIFEGUARD", active: true, inTeam: false },
      }),
    ).toMatch(/equipe do posto/);
  });

  it.each(["SUSPENDED", "INACTIVE"] as const)(
    "refuses a post that is %s",
    (postStatus) => {
      expect(checkAddEntry({ ...validAdd, postStatus })).toMatch(
        /não está em operação/,
      );
    },
  );

  it("refuses dates outside the window and past days", () => {
    expect(checkAddEntry({ ...validAdd, date: "2026-10-15" })).toMatch(
      /fora dos três dias/,
    );
    expect(
      checkAddEntry({
        ...validAdd,
        windowStart: "2026-10-10",
        date: "2026-10-11",
      }),
    ).toMatch(/já passaram/);
  });

  it("requires a justification for someone not declared available", () => {
    for (const availability of ["UNAVAILABLE", "NOT_SENT"] as const) {
      expect(checkAddEntry({ ...validAdd, availability })).toMatch(
        /não declarou disponibilidade/,
      );
      expect(
        checkAddEntry({
          ...validAdd,
          availability,
          reason: "Cobertura de férias",
        }),
      ).toBeNull();
    }
  });

  it("requires a justification to change a confirmed schedule", () => {
    for (const scheduleStatus of ["CONFIRMED", "CHANGED"] as const) {
      expect(checkAddEntry({ ...validAdd, scheduleStatus })).toMatch(
        /já foi confirmada/,
      );
      // Blank padding does not count.
      expect(
        checkAddEntry({ ...validAdd, scheduleStatus, reason: "   ok   " }),
      ).toMatch(/justificativa/);
      expect(
        checkAddEntry({
          ...validAdd,
          scheduleStatus,
          reason: "Troca de folga",
        }),
      ).toBeNull();
    }
  });
});

describe("removing a lifeguard from a schedule", () => {
  const base = {
    scheduleStatus: "PROPOSED" as const,
    date: "2026-10-13",
    today: TODAY,
    reason: "",
  };

  it("is free while proposed", () => {
    expect(checkRemoveEntry(base)).toBeNull();
  });

  it("needs a justification once confirmed", () => {
    expect(checkRemoveEntry({ ...base, scheduleStatus: "CONFIRMED" })).toMatch(
      /justificativa/,
    );
    expect(
      checkRemoveEntry({
        ...base,
        scheduleStatus: "CHANGED",
        reason: "Atestado médico",
      }),
    ).toBeNull();
  });

  it("never changes past days", () => {
    expect(
      checkRemoveEntry({ ...base, date: "2026-10-11", reason: "Correção" }),
    ).toMatch(/já passaram/);
  });
});

describe("confirmation and states", () => {
  it("confirms a proposal with at least one entry", () => {
    expect(checkConfirm({ status: "PROPOSED", entryCount: 2 })).toBeNull();
    expect(checkConfirm({ status: "PROPOSED", entryCount: 0 })).toMatch(
      /pelo menos um/,
    );
  });

  it("does not confirm twice", () => {
    expect(checkConfirm({ status: "CONFIRMED", entryCount: 2 })).toMatch(
      /já foi confirmada/,
    );
    expect(checkConfirm({ status: "CHANGED", entryCount: 2 })).toMatch(
      /já foi confirmada/,
    );
  });

  it("marks published schedules as changed after any change", () => {
    expect(statusAfterChange("PROPOSED")).toBe("PROPOSED");
    expect(statusAfterChange("CONFIRMED")).toBe("CHANGED");
    expect(statusAfterChange("CHANGED")).toBe("CHANGED");
  });

  it("publishes only confirmed or changed schedules", () => {
    expect(isPublished("PROPOSED")).toBe(false);
    expect(isPublished("CONFIRMED")).toBe(true);
    expect(isPublished("CHANGED")).toBe(true);
  });
});
