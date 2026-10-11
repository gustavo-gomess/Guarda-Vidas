import { registrationSchema } from "@/features/attendance/schemas";
import { registerAttendance } from "@/features/attendance/service";
import { getCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Receives an entry or exit, online or from the offline queue.
 *
 * A Route Handler, not a Server Action, on purpose: a page opened offline
 * from the service worker cache may be older than the deployed server, and
 * Server Action ids change between deploys. This URL does not.
 */

const MAX_BODY_BYTES = 8 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Same-origin check, like Next.js does for Server Actions. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json(403, { code: "BAD_ORIGIN", message: "Origem não permitida." });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json(415, { code: "BAD_CONTENT", message: "Envie JSON." });
  }

  const session = await getCurrentSession();
  if (!session) {
    // The device keeps the record; it is sent again after a new login.
    return json(401, {
      code: "UNAUTHENTICATED",
      message: "Sessão expirada. Entre novamente para enviar os registros.",
    });
  }
  const { actor } = session;
  if (actor.mustChangePassword) {
    return json(403, {
      code: "PASSWORD_CHANGE",
      message: "Troque a senha temporária antes de registrar presença.",
    });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return json(413, { code: "TOO_LARGE", message: "Registro grande demais." });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { code: "INVALID", message: "Registro inválido." });
  }
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { code: "INVALID", message: "Registro inválido." });
  }

  const result = await registerAttendance(getDb(), actor, parsed.data);
  if (!result.ok) {
    logger.warn("attendance.refused", {
      actorId: actor.id,
      recordId: parsed.data.id,
      code: result.code,
    });
    return json(result.httpStatus, {
      code: result.code,
      message: result.message,
    });
  }

  logger.info("attendance.stored", {
    actorId: actor.id,
    recordId: result.record.id,
    created: result.created,
    origin: result.record.origin,
    status: result.record.status,
  });
  return json(result.created ? 201 : 200, {
    record: result.record,
    serverTime: new Date().toISOString(),
  });
}
