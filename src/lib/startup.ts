import "server-only";

import { getEnv } from "@/env";
import { EnvValidationError } from "@/lib/env-schema";

/**
 * Node.js-only startup checks, loaded from src/instrumentation.ts.
 *
 * On invalid configuration Next.js would log the error and keep serving 500s.
 * Exit instead, so the problem is obvious locally and the deploy fails its
 * health checks.
 */
export function runStartupChecks(): void {
  try {
    getEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    process.stderr.write(`\n${error.message}\n\n`);
    process.exit(1);
  }
}
