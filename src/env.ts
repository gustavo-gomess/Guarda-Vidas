import "server-only";

import { parseServerEnv, type ServerEnv } from "@/lib/env-schema";

export type { ServerEnv } from "@/lib/env-schema";

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Use this instead of reading process.env.
 *
 * Parsed on first call, not at import time: `next build` imports route
 * modules, and the build must not require runtime secrets. The server start
 * (src/instrumentation.ts) calls it to fail fast on invalid configuration.
 */
export function getEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
