/**
 * Presence states and labels shared by the server and the device.
 *
 * The first two exist only on the device; the server never stores them.
 * A record is only "confirmed by the server" after the server answered.
 */

export type DeviceState = "LOCAL" | "SYNC_PENDING";
export type ServerStatus =
  "AWAITING_VALIDATION" | "VALIDATED" | "REJECTED" | "UNDER_REVIEW";
export type AttendanceState = DeviceState | ServerStatus;

export type AttendanceKind = "CHECK_IN" | "CHECK_OUT";
export type AttendanceOrigin = "ONLINE" | "OFFLINE";
export type LocationStatus =
  "CAPTURED" | "DENIED" | "UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED";

export const STATE_LABELS: Record<AttendanceState, string> = {
  LOCAL: "Registrado só neste aparelho (não enviado)",
  SYNC_PENDING: "Sincronização pendente (sem confirmação do servidor)",
  AWAITING_VALIDATION: "Recebido pelo servidor, aguardando validação",
  VALIDATED: "Validado",
  REJECTED: "Rejeitado",
  UNDER_REVIEW: "Divergência em análise",
};

/** Provisional = not (yet) accepted as official presence. */
export function isProvisional(state: AttendanceState): boolean {
  return state !== "VALIDATED";
}

export const KIND_LABELS: Record<AttendanceKind, string> = {
  CHECK_IN: "Entrada",
  CHECK_OUT: "Saída",
};

export const ORIGIN_LABELS: Record<AttendanceOrigin, string> = {
  ONLINE: "Online (hora do servidor)",
  OFFLINE: "Sem internet (hora do aparelho)",
};

export const LOCATION_LABELS: Record<LocationStatus, string> = {
  CAPTURED: "Localização obtida",
  DENIED: "Localização negada pelo usuário",
  UNAVAILABLE: "Localização indisponível",
  TIMEOUT: "Localização demorou demais",
  UNSUPPORTED: "Aparelho sem localização",
};
