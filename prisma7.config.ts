import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files by itself. Load the same files Next.js
// uses locally; real environments provide variables directly.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read directly (not via env()) so `prisma generate` works without a
    // database, e.g. in CI. Migrate commands fail clearly when it is missing.
    url: process.env.DATABASE_URL,
    // Optional. `migrate dev` creates a temporary shadow database by itself;
    // set this only where that is not allowed.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
