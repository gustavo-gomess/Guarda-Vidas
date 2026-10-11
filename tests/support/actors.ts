import type { Actor } from "@/lib/auth/policy";

export const POST_A = "11111111-1111-4111-8111-111111111111";
export const POST_B = "22222222-2222-4222-8222-222222222222";
export const LIFEGUARD_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";

function actor(overrides: Partial<Actor>): Actor {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    name: "Teste",
    role: "LIFEGUARD",
    isAdmin: false,
    mustChangePassword: false,
    coordinatedPostIds: [],
    assignedPostIds: [],
    captainPostIds: [],
    ...overrides,
  };
}

export const actors = {
  admin: actor({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "COORDINATOR",
    isAdmin: true,
  }),
  authority: actor({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role: "AUTHORITY",
  }),
  coordinatorA: actor({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    role: "COORDINATOR",
    coordinatedPostIds: [POST_A],
  }),
  lifeguardA: actor({
    id: LIFEGUARD_ID,
    role: "LIFEGUARD",
    assignedPostIds: [POST_A],
  }),
  captainA: actor({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    role: "LIFEGUARD",
    assignedPostIds: [POST_A],
    captainPostIds: [POST_A],
  }),
};

export function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
