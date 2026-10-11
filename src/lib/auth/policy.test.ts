import { describe, expect, it } from "vitest";

import {
  canActAsCaptain,
  canChangePostStatus,
  canManageAvailabilityWindows,
  canManageSchedule,
  canSubmitAvailability,
  canViewAvailability,
  canViewPostSchedules,
  canManagePosts,
  canManagePostTeam,
  canManageUsers,
  canViewAllPosts,
  canViewPost,
  canViewUser,
  type Actor,
} from "@/lib/auth/policy";

const POST_A = "post-a";
const POST_B = "post-b";

function actor(overrides: Partial<Actor>): Actor {
  return {
    id: "actor",
    name: "Actor",
    role: "LIFEGUARD",
    isAdmin: false,
    mustChangePassword: false,
    coordinatedPostIds: [],
    assignedPostIds: [],
    captainPostIds: [],
    ...overrides,
  };
}

const authority = actor({ id: "auth", role: "AUTHORITY" });
const admin = actor({ id: "admin", role: "COORDINATOR", isAdmin: true });
const coordinatorA = actor({
  id: "coord-a",
  role: "COORDINATOR",
  coordinatedPostIds: [POST_A],
});
const lifeguardA = actor({
  id: "lg-a",
  role: "LIFEGUARD",
  assignedPostIds: [POST_A],
});
const captainA = actor({
  id: "cap-a",
  role: "LIFEGUARD",
  assignedPostIds: [POST_A],
  captainPostIds: [POST_A],
});

describe("administration", () => {
  it.each([
    ["admin", admin, true],
    ["authority", authority, false],
    ["coordinator", coordinatorA, false],
    ["lifeguard", lifeguardA, false],
    ["captain", captainA, false],
  ])("%s manages users and posts: %s", (_label, who, expected) => {
    expect(canManageUsers(who)).toBe(expected);
    expect(canManagePosts(who)).toBe(expected);
  });
});

describe("authority (read-only)", () => {
  it("sees every post", () => {
    expect(canViewAllPosts(authority)).toBe(true);
    expect(canViewPost(authority, POST_A)).toBe(true);
    expect(canViewPost(authority, POST_B)).toBe(true);
  });

  it("cannot change any team", () => {
    expect(canManagePostTeam(authority, POST_A)).toBe(false);
    expect(canManagePostTeam(authority, POST_B)).toBe(false);
  });

  it("is never a captain", () => {
    expect(canActAsCaptain(authority, POST_A)).toBe(false);
  });
});

describe("coordinator (own area only)", () => {
  it("sees and manages the posts in their area", () => {
    expect(canViewPost(coordinatorA, POST_A)).toBe(true);
    expect(canManagePostTeam(coordinatorA, POST_A)).toBe(true);
  });

  it("is denied posts outside their area", () => {
    expect(canViewAllPosts(coordinatorA)).toBe(false);
    expect(canViewPost(coordinatorA, POST_B)).toBe(false);
    expect(canManagePostTeam(coordinatorA, POST_B)).toBe(false);
  });

  it("ignores a forged coordinatedPostIds on a non-coordinator", () => {
    const forged = actor({ role: "LIFEGUARD", coordinatedPostIds: [POST_B] });
    expect(canViewPost(forged, POST_B)).toBe(false);
    expect(canManagePostTeam(forged, POST_B)).toBe(false);
  });
});

describe("lifeguard", () => {
  it("sees only the posts they are assigned to", () => {
    expect(canViewPost(lifeguardA, POST_A)).toBe(true);
    expect(canViewPost(lifeguardA, POST_B)).toBe(false);
  });

  it("cannot manage teams, users or posts", () => {
    expect(canManagePostTeam(lifeguardA, POST_A)).toBe(false);
    expect(canManageUsers(lifeguardA)).toBe(false);
  });

  it("has no captain duties unless captain", () => {
    expect(canActAsCaptain(lifeguardA, POST_A)).toBe(false);
  });
});

describe("captain (lifeguard assignment, not a role)", () => {
  it("acts as captain only on their own post", () => {
    expect(canActAsCaptain(captainA, POST_A)).toBe(true);
    expect(canActAsCaptain(captainA, POST_B)).toBe(false);
  });

  it("gets no administrative or team powers from being captain", () => {
    expect(canManagePostTeam(captainA, POST_A)).toBe(false);
    expect(canManageUsers(captainA)).toBe(false);
  });

  it("requires the LIFEGUARD role", () => {
    const coordinatorWithFlag = actor({
      role: "COORDINATOR",
      captainPostIds: [POST_A],
    });
    expect(canActAsCaptain(coordinatorWithFlag, POST_A)).toBe(false);
  });
});

describe("viewing users (horizontal access)", () => {
  const otherLifeguardA = {
    id: "lg-a2",
    role: "LIFEGUARD" as const,
    assignedPostIds: [POST_A],
  };
  const lifeguardB = {
    id: "lg-b",
    role: "LIFEGUARD" as const,
    assignedPostIds: [POST_B],
  };

  it("everyone sees themselves", () => {
    expect(
      canViewUser(lifeguardA, {
        id: lifeguardA.id,
        role: "LIFEGUARD",
        assignedPostIds: [POST_A],
      }),
    ).toBe(true);
  });

  it("a lifeguard cannot see another user, even from the same post", () => {
    expect(canViewUser(lifeguardA, otherLifeguardA)).toBe(false);
    expect(canViewUser(lifeguardA, lifeguardB)).toBe(false);
  });

  it("a coordinator sees users of their area only", () => {
    expect(canViewUser(coordinatorA, otherLifeguardA)).toBe(true);
    expect(canViewUser(coordinatorA, lifeguardB)).toBe(false);
  });

  it("authority and admin see everyone", () => {
    expect(canViewUser(authority, lifeguardB)).toBe(true);
    expect(canViewUser(admin, lifeguardB)).toBe(true);
  });
});

describe("availability and schedules", () => {
  const authorityAdmin = actor({ role: "AUTHORITY", isAdmin: true });

  it.each([
    ["coordinator", coordinatorA, true, false, true],
    ["admin coordinator", admin, true, false, true],
    ["authority", authority, false, false, true],
    ["lifeguard", lifeguardA, false, true, false],
    ["captain", captainA, false, true, false],
  ])(
    "%s: opens windows %s, sends availability %s, sees availability %s",
    (_label, who, windows, submit, view) => {
      expect(canManageAvailabilityWindows(who)).toBe(windows);
      expect(canSubmitAvailability(who)).toBe(submit);
      expect(canViewAvailability(who)).toBe(view);
    },
  );

  it("only the post's coordinator manages its schedule", () => {
    expect(canManageSchedule(coordinatorA, POST_A)).toBe(true);
    expect(canManageSchedule(coordinatorA, POST_B)).toBe(false);
  });

  it.each([
    ["authority", authority],
    ["authority with admin access", authorityAdmin],
    ["admin outside the post's area", admin],
    ["lifeguard", lifeguardA],
    ["captain", captainA],
  ])("the %s cannot change schedules", (_label, who) => {
    expect(canManageSchedule(who, POST_A)).toBe(false);
    expect(canManageSchedule(who, POST_B)).toBe(false);
  });

  it("whole schedules are visible to authority, admins and the coordinator", () => {
    expect(canViewPostSchedules(authority, POST_B)).toBe(true);
    expect(canViewPostSchedules(admin, POST_B)).toBe(true);
    expect(canViewPostSchedules(coordinatorA, POST_A)).toBe(true);
    expect(canViewPostSchedules(coordinatorA, POST_B)).toBe(false);
    expect(canViewPostSchedules(lifeguardA, POST_A)).toBe(false);
    expect(canViewPostSchedules(captainA, POST_A)).toBe(false);
  });

  it("post status follows team management", () => {
    expect(canChangePostStatus(coordinatorA, POST_A)).toBe(true);
    expect(canChangePostStatus(coordinatorA, POST_B)).toBe(false);
    expect(canChangePostStatus(admin, POST_B)).toBe(true);
    expect(canChangePostStatus(authority, POST_A)).toBe(false);
    expect(canChangePostStatus(captainA, POST_A)).toBe(false);
  });
});
