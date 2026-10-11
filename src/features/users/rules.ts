import { roleAllowsAdmin, type Role } from "@/lib/auth/policy";

export type UserState = {
  id: string;
  role: Role;
  isAdmin: boolean;
  active: boolean;
};

export type UserChange = Partial<
  Pick<UserState, "role" | "isAdmin" | "active">
>;

/**
 * Validates an administrator's change to a user account. Returns a message
 * safe to show, or null when the change is allowed.
 *
 * `otherActiveAdmins` counts active administrators other than the target.
 */
export function checkUserChange(input: {
  actorId: string;
  target: UserState;
  change: UserChange;
  otherActiveAdmins: number;
}): string | null {
  const { actorId, target, change, otherActiveAdmins } = input;
  const next = { ...target, ...change };

  if (actorId === target.id) {
    if (
      next.role !== target.role ||
      next.isAdmin !== target.isAdmin ||
      next.active !== target.active
    ) {
      return "Você não pode alterar o próprio perfil, acesso de administrador ou situação. Peça a outro administrador.";
    }
  }

  if (next.isAdmin && !roleAllowsAdmin(next.role)) {
    return "Guarda-vidas não pode ser administrador.";
  }

  const losesAdmin =
    target.isAdmin && target.active && !(next.isAdmin && next.active);
  if (losesAdmin && otherActiveAdmins === 0) {
    return "O sistema precisa de pelo menos um administrador ativo.";
  }

  return null;
}

/** Assignments a role cannot keep after a role change. */
export function assignmentsToRemove(newRole: Role): {
  coordinatedPosts: boolean;
  postAssignments: boolean;
} {
  return {
    coordinatedPosts: newRole !== "COORDINATOR",
    postAssignments: newRole !== "LIFEGUARD",
  };
}
