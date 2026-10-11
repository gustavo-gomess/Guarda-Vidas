import { connection } from "next/server";

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

const DB_TIMEOUT_MS = 3000;

/**
 * Liveness and database connectivity check for hosting and monitoring.
 * Responds only with status words; failure details go to the server log.
 */
export async function GET(): Promise<Response> {
  // Request-time only: never prerendered, so the build needs no database.
  await connection();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database check timed out")),
          DB_TIMEOUT_MS,
        );
      }),
    ]);
    return Response.json(
      { status: "ok", database: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("health check failed", { error });
    return Response.json(
      { status: "error", database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}
