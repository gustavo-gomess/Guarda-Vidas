/**
 * Daily closing rules. Provisional (OD-15, OD-17): closing per post and
 * day by the post's coordinator; pending items block only consolidation;
 * the closing never locks or changes the day's records.
 *
 * Transitions (every arrow except "save notes" freezes a new version):
 *   (none) or DRAFT ── submit ──────▶ SUBMITTED
 *   SUBMITTED or CORRECTED ── consolidate (no pending items) ──▶ CONSOLIDATED
 *   SUBMITTED, CONSOLIDATED or CORRECTED ── correct (reason) ──▶ CORRECTED
 *   (none) ── save notes ──▶ DRAFT (notes only; nothing frozen)
 */

export type ClosingStatus =
  "DRAFT" | "SUBMITTED" | "CONSOLIDATED" | "CORRECTED";
export type ClosingAction = "SUBMIT" | "CONSOLIDATE" | "CORRECT";
/** For screens: a day with no closing at all is NOT_STARTED. */
export type ReportStatus = ClosingStatus | "NOT_STARTED";

export const MIN_REASON_LENGTH = 5;

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  NOT_STARTED: "Não iniciado",
  DRAFT: "Rascunho",
  SUBMITTED: "Enviado",
  CONSOLIDATED: "Consolidado",
  CORRECTED: "Corrigido",
};

export const ACTION_LABELS: Record<ClosingAction, string> = {
  SUBMIT: "Enviar fechamento",
  CONSOLIDATE: "Consolidar",
  CORRECT: "Registrar correção",
};

const FROM: Record<ClosingAction, readonly (ClosingStatus | null)[]> = {
  SUBMIT: [null, "DRAFT"],
  CONSOLIDATE: ["SUBMITTED", "CORRECTED"],
  CORRECT: ["SUBMITTED", "CONSOLIDATED", "CORRECTED"],
};

const TO: Record<ClosingAction, ClosingStatus> = {
  SUBMIT: "SUBMITTED",
  CONSOLIDATE: "CONSOLIDATED",
  CORRECT: "CORRECTED",
};

export const VERSION_KIND: Record<
  ClosingAction,
  "SUBMISSION" | "CONSOLIDATION" | "CORRECTION"
> = {
  SUBMIT: "SUBMISSION",
  CONSOLIDATE: "CONSOLIDATION",
  CORRECT: "CORRECTION",
};

export function nextStatus(action: ClosingAction): ClosingStatus {
  return TO[action];
}

export function availableClosingActions(
  status: ClosingStatus | null,
): ClosingAction[] {
  return (Object.keys(FROM) as ClosingAction[]).filter((action) =>
    FROM[action].includes(status),
  );
}

/** What still needs doing for a day's report, for the panels. */
export function reportNeeds(
  status: ReportStatus,
): "SEND" | "CONSOLIDATE" | null {
  if (status === "NOT_STARTED" || status === "DRAFT") return "SEND";
  if (status === "SUBMITTED" || status === "CORRECTED") return "CONSOLIDATE";
  return null;
}

export function checkClosingAction(input: {
  action: ClosingAction;
  canClose: boolean;
  status: ClosingStatus | null;
  expectedVersion: number;
  currentVersion: number;
  date: string;
  today: string;
  pendingTotal: number;
  reason: string;
}): string | null {
  if (!input.canClose) return "Você não tem permissão para esta operação.";
  if (input.date > input.today)
    return "Não é possível fechar um dia que ainda não chegou.";
  if (input.expectedVersion !== input.currentVersion) {
    return "O fechamento mudou desde que você abriu a página. Confira a versão atual.";
  }
  if (!FROM[input.action].includes(input.status)) {
    return `Não é possível "${ACTION_LABELS[input.action].toLowerCase()}" neste estado.`;
  }
  if (input.action === "CONSOLIDATE" && input.pendingTotal > 0) {
    return `Há ${input.pendingTotal} pendência(s) no dia. Resolva-as antes de consolidar (ou envie com as pendências identificadas).`;
  }
  if (
    input.action === "CORRECT" &&
    input.reason.trim().length < MIN_REASON_LENGTH
  ) {
    return `Informe o motivo da correção (mínimo de ${MIN_REASON_LENGTH} caracteres).`;
  }
  return null;
}
