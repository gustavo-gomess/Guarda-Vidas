import type { CreateAlertPayload } from "@/features/alerts/schemas";

/**
 * Sends an alert and says honestly what happened. Only an answer with the
 * stored alert counts as sent; no answer, a proxy page or a server error
 * means NOT sent.
 */
export type SendAlertOutcome =
  | {
      kind: "stored";
      created: boolean;
      alert: { id: string; status: string; createdAt: string };
    }
  | { kind: "not-sent"; reason: "network" | "server" | "session" }
  | { kind: "refused"; code: string; message: string; activeAlertId?: string };

export async function sendAlert(
  payload: CreateAlertPayload,
): Promise<SendAlertOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/alertas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return { kind: "not-sent", reason: "network" };
  }
  let body: {
    alert?: { id: string; status: string; createdAt: string };
    code?: string;
    message?: string;
    activeAlertId?: string;
  };
  try {
    body = await response.json();
  } catch {
    // No JSON: a proxy, captive portal or crashed server answered.
    return {
      kind: "not-sent",
      reason: response.status >= 500 ? "server" : "network",
    };
  }
  if (response.ok && body.alert) {
    return {
      kind: "stored",
      created: response.status === 201,
      alert: body.alert,
    };
  }
  if (response.status === 401) return { kind: "not-sent", reason: "session" };
  if (response.status >= 500 || !body.code) {
    return { kind: "not-sent", reason: "server" };
  }
  return {
    kind: "refused",
    code: body.code,
    message: body.message ?? "O servidor recusou o alerta.",
    activeAlertId: body.activeAlertId,
  };
}
