import "server-only";

import { getEnv } from "@/env";
import { createLogger, type Logger } from "@/lib/logger-core";

let instance: Logger | undefined;

function getLogger(): Logger {
  if (!instance) {
    const env = getEnv();
    instance = createLogger({
      level: env.LOG_LEVEL,
      json: env.NODE_ENV === "production",
      includeStack: env.NODE_ENV !== "production",
    });
  }
  return instance;
}

/**
 * Server logger. Context objects are redacted (see logger-core.ts), but the
 * message string is logged as is: never interpolate user data or secrets
 * into it. Pass identifiers in the context instead.
 *
 * Created on first use so importing it does not read the environment.
 */
export const logger: Logger = {
  debug: (message, context) => getLogger().debug(message, context),
  info: (message, context) => getLogger().info(message, context),
  warn: (message, context) => getLogger().warn(message, context),
  error: (message, context) => getLogger().error(message, context),
};
