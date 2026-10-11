import type {
  AuthStore,
  LoginUser,
  StoredSession,
} from "@/lib/auth/auth-service";

type MemoryUser = LoginUser & { username: string };

/** In-memory AuthStore for unit tests. Mirrors PrismaAuthStore behavior. */
export class MemoryAuthStore implements AuthStore {
  users = new Map<string, MemoryUser>();
  sessions = new Map<string, Omit<StoredSession, "userActive">>();

  addUser(user: MemoryUser): void {
    this.users.set(user.id, { ...user });
  }

  user(id: string): MemoryUser {
    const user = this.users.get(id);
    if (!user) throw new Error(`no user ${id}`);
    return user;
  }

  async findUserForLogin(username: string) {
    const user = [...this.users.values()].find((u) => u.username === username);
    return user ? { ...user } : null;
  }

  async recordFailedLogin(
    userId: string,
    failedLoginAttempts: number,
    lockedUntil: Date | null,
  ) {
    Object.assign(this.user(userId), { failedLoginAttempts, lockedUntil });
  }

  async recordSuccessfulLogin(userId: string, newPasswordHash?: string) {
    const user = this.user(userId);
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    if (newPasswordHash) user.passwordHash = newPasswordHash;
  }

  async createSession(session: Omit<StoredSession, "userActive">) {
    this.sessions.set(session.id, { ...session });
  }

  async findSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) return null;
    return { ...session, userActive: this.user(session.userId).active };
  }

  async extendSession(id: string, expiresAt: Date) {
    const session = this.sessions.get(id);
    if (session) session.expiresAt = expiresAt;
  }

  async deleteSession(id: string) {
    this.sessions.delete(id);
  }

  async deleteUserSessions(userId: string, exceptSessionId?: string) {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && id !== exceptSessionId) {
        this.sessions.delete(id);
      }
    }
  }
}
