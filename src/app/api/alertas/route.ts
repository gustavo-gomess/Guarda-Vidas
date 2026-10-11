import { createAlertSchema } from "@/features/alerts/schemas";
import { createAlert } from "@/features/alerts/service";
import { getCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isSameOrigin, jsonResponse, readJsonRequest } from "@/lib/http";
import { logger } from "@/lib/logger";

/**
 * Receives a reinforcement alert. Answers 201 only after the alert is
 * committed in the database; any failure is an error answer, so the screen
 * never shows "sent" without the server's confirmation.
 *
 * A Route Handler (stable URL) because /alertas/novo can be opened from the
 * offline cache, where Server Action ids could be outdated.
 */

const MAX_BODY_BYTES = 4 * 1024;

function unavailable() {
  return jsonResponse(503, {
    code: "UNAVAILABLE",
    message: "Servidor indisponível: o alerta não foi registrado.",
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonResponse(403, {
      code: "BAD_ORIGIN",
      message: "Origem não permitida.",
    });
  }
  let session;
  try {
    session = await getCurrentSession();
  } catch {
    // The session lives in the database: if it is down, nothing was sent.
    logger.error("alert.session_unavailable", {});
    return unavailable();
  }
  if (!session) {
    return jsonResponse(401, {
      code: "UNAUTHENTICATED",
      message: "Sessão expirada. Entre novamente.",
    });
  }
  const { actor } = session;
  if (actor.mustChangePassword) {
    return jsonResponse(403, {
      code: "PASSWORD_CHANGE",
      message: "Troque a senha temporária antes de enviar alertas.",
    });
  }

  const read = await readJsonRequest(request, MAX_BODY_BYTES);
  if ("response" in read) return read.response;
  const parsed = createAlertSchema.safeParse(read.body);
  if (!parsed.success) {
    return jsonResponse(400, {
      code: "INVALID",
      message: parsed.error.issues[0]?.message ?? "Alerta inválido.",
    });
  }

  let result;
  try {
    result = await createAlert(getDb(), actor, parsed.data);
  } catch (error) {
    // Database unavailable or similar: say clearly that nothing was sent.
    logger.error("alert.store_failed", {
      actorId: actor.id,
      alertId: parsed.data.id,
      // Name and code only: database messages may quote the alert text.
      errorName: error instanceof Error ? error.name : "unknown",
      errorCode:
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : undefined,
    });
    return unavailable();
  }

  if (!result.ok) {
    logger.warn("alert.refused", {
      actorId: actor.id,
      alertId: parsed.data.id,
      code: result.code,
    });
    return jsonResponse(result.httpStatus, {
      code: result.code,
      message: result.message,
      activeAlertId: result.activeAlertId,
    });
  }
  logger.info("alert.stored", {
    actorId: actor.id,
    alertId: result.alert.id,
    created: result.created,
  });
  return jsonResponse(result.created ? 201 : 200, { alert: result.alert });
}
