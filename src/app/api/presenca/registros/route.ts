import { registrationSchema } from "@/features/attendance/schemas";
import { registerAttendance } from "@/features/attendance/service";
import { getCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isSameOrigin, jsonResponse, readJsonRequest } from "@/lib/http";
import { logger } from "@/lib/logger";

/**
 * Receives an entry or exit, online or from the offline queue.
 *
 * A Route Handler, not a Server Action, on purpose: a page opened offline
 * from the service worker cache may be older than the deployed server, and
 * Server Action ids change between deploys. This URL does not.
 */

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  // Origin and content type before anything else, including the session.
  if (!isSameOrigin(request)) {
    return jsonResponse(403, {
      code: "BAD_ORIGIN",
      message: "Origem não permitida.",
    });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return jsonResponse(415, { code: "BAD_CONTENT", message: "Envie JSON." });
  }

  const session = await getCurrentSession();
  if (!session) {
    // The device keeps the record; it is sent again after a new login.
    return jsonResponse(401, {
      code: "UNAUTHENTICATED",
      message: "Sessão expirada. Entre novamente para enviar os registros.",
    });
  }
  const { actor } = session;
  if (actor.mustChangePassword) {
    return jsonResponse(403, {
      code: "PASSWORD_CHANGE",
      message: "Troque a senha temporária antes de registrar presença.",
    });
  }

  const read = await readJsonRequest(request, MAX_BODY_BYTES);
  if ("response" in read) return read.response;
  const { body } = read;
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(400, {
      code: "INVALID",
      message: "Registro inválido.",
    });
  }

  const result = await registerAttendance(getDb(), actor, parsed.data);
  if (!result.ok) {
    logger.warn("attendance.refused", {
      actorId: actor.id,
      recordId: parsed.data.id,
      code: result.code,
    });
    return jsonResponse(result.httpStatus, {
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
  return jsonResponse(result.created ? 201 : 200, {
    record: result.record,
    serverTime: new Date().toISOString(),
  });
}
