import type { Instrumentation } from "next";

export async function register() {
  // Validate the environment on server start; exits on invalid config.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupChecks } = await import("./lib/startup");
    runStartupChecks();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logger } = await import("./lib/logger");
  // Path without query string and no headers: both may carry personal data
  // or credentials.
  logger.error("request failed", {
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    error,
  });
};
