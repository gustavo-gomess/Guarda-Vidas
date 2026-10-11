import { describe, expect, it } from "vitest";

import {
  assignmentsToRemove,
  changedFields,
  checkUserChange,
  type UserState,
} from "@/features/users/rules";

const adminTarget: UserState = {
  id: "admin-1",
  role: "COORDINATOR",
  isAdmin: true,
  active: true,
};
const lifeguard: UserState = {
  id: "lg-1",
  role: "LIFEGUARD",
  isAdmin: false,
  active: true,
};

describe("checkUserChange", () => {
  it("allows a normal change by another administrator", () => {
    expect(
      checkUserChange({
        actorId: "admin-2",
        target: lifeguard,
        change: { active: false },
        otherActiveAdmins: 1,
      }),
    ).toBeNull();
  });

  it.each([
    ["role", { role: "AUTHORITY" as const }],
    ["admin flag", { isAdmin: false }],
    ["active status", { active: false }],
  ])("blocks changing your own %s", (_label, change) => {
    expect(
      checkUserChange({
        actorId: adminTarget.id,
        target: adminTarget,
        change,
        otherActiveAdmins: 3,
      }),
    ).toMatch(/próprio/);
  });

  it("allows an administrator to save their own unchanged access", () => {
    expect(
      checkUserChange({
        actorId: adminTarget.id,
        target: adminTarget,
        change: { role: "COORDINATOR", isAdmin: true, active: true },
        otherActiveAdmins: 0,
      }),
    ).toBeNull();
  });

  it("refuses to make a lifeguard an administrator", () => {
    expect(
      checkUserChange({
        actorId: "admin-2",
        target: lifeguard,
        change: { isAdmin: true },
        otherActiveAdmins: 1,
      }),
    ).toMatch(/Guarda-vidas não pode/);
    expect(
      checkUserChange({
        actorId: "admin-2",
        target: adminTarget,
        change: { role: "LIFEGUARD" },
        otherActiveAdmins: 1,
      }),
    ).toMatch(/Guarda-vidas não pode/);
  });

  it.each([
    ["removing the admin flag", { isAdmin: false }],
    ["deactivating", { active: false }],
  ])("keeps at least one active administrator when %s", (_label, change) => {
    expect(
      checkUserChange({
        actorId: "admin-2",
        target: adminTarget,
        change,
        otherActiveAdmins: 0,
      }),
    ).toMatch(/pelo menos um administrador/);
    expect(
      checkUserChange({
        actorId: "admin-2",
        target: adminTarget,
        change,
        otherActiveAdmins: 1,
      }),
    ).toBeNull();
  });
});

describe("assignmentsToRemove", () => {
  it("drops assignments the new role cannot hold", () => {
    expect(assignmentsToRemove("LIFEGUARD")).toEqual({
      coordinatedPosts: true,
      postAssignments: false,
    });
    expect(assignmentsToRemove("COORDINATOR")).toEqual({
      coordinatedPosts: false,
      postAssignments: true,
    });
    expect(assignmentsToRemove("AUTHORITY")).toEqual({
      coordinatedPosts: true,
      postAssignments: true,
    });
  });
});

describe("changedFields", () => {
  it("returns only changed values, or null", () => {
    const before = { name: "Ana", role: "LIFEGUARD", active: true };
    expect(changedFields(before, { name: "Ana", active: false })).toEqual({
      before: { active: true },
      after: { active: false },
    });
    expect(changedFields(before, { name: "Ana" })).toBeNull();
  });
});
