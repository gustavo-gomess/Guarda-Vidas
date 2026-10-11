import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { getEnv } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";

const globalForDb = globalThis as unknown as { db?: PrismaClient };

function createDb() {
  const env = getEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    // Prisma's own logs go straight to the console, bypassing the logger's
    // redaction, so they are off outside development. Errors still reach the
    // caller and are logged through `logger` / onRequestError. Queries are
    // never logged: their parameters may contain personal data.
    log: env.NODE_ENV === "development" ? ["warn", "error"] : [],
  });
}

/**
 * Shared Prisma client, created on first use (never at import time, so the
 * build does not need a database). Reused across hot reloads in development.
 */
export function getDb(): PrismaClient {
  globalForDb.db ??= createDb();
  return globalForDb.db;
}
