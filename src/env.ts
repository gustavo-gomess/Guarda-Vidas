import "server-only";

import { z } from "zod";

/**
 * Server-side environment variables, validated once at startup.
 * Add every new variable here and document it in .env.example.
 * Import `env` from this module instead of reading process.env directly.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    // Only variable names and issues are logged, never the values.
    console.error(
      "Invalid environment variables:",
      z.flattenError(result.error).fieldErrors,
    );
    throw new Error("Invalid environment variables. See the log above.");
  }

  return result.data;
}

export const env = parseEnv();
