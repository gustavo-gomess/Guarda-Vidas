/**
 * Reinforcement alert rules, free of Next.js and the database.
 *
 * Approved (Prompt 6): the post's captain creates; the server stores the
 * alert before confirming; the responsible coordinators see, acknowledge,
 * put in progress and close it; cancelling and closing keep the history;
 * unacknowledged alerts stand out; every action records who did it.
 * Provisional (docs/OPEN-DECISIONS.md, OD-36 to OD-38): who besides the
 * captain may create, who cancels, the duplicate rule and the notes.
 *
 *   OPEN ──acknowledge──▶ ACKNOWLEDGED ──start──▶ IN_PROGRESS ──close──▶ CLOSED
 *     │                       │   └──────────close──────────────────────▲
 *     └──────────── cancel ───┴──────────── cancel ─▶ CANCELLED
 */

export type AlertStatus =
  "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS" | "CLOSED" | "CANCELLED";

export type AlertAction = "ACKNOWLEDGE" | "START" | "CLOSE" | "CANCEL";

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  OPEN: "Aguardando reconhecimento",
  ACKNOWLEDGED: "Reconhecido",
  IN_PROGRESS: "Em atendimento",
  CLOSED: "Encerrado",
  CANCELLED: "Cancelado",
};

export const ALERT_ACTION_LABELS: Record<AlertAction, string> = {
  ACKNOWLEDGE: "Reconhecer",
  START: "Colocar em atendimento",
  CLOSE: "Encerrar",
  CANCEL: "Cancelar",
};

export const ACTIVE_STATUSES: readonly AlertStatus[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
];

export const MIN_NOTE_LENGTH = 5;
export const MAX_DESCRIPTION = 500;

/**
 * Shown whenever an alert could not be confirmed by the server. The exact
 * official channel is an operational decision still pending (OD-13).
 */
export const NOT_SENT_GUIDANCE =
  "O ALERTA NÃO FOI ENVIADO. Use agora o canal oficial de emergência (rádio ou telefone, conforme o procedimento do seu posto).";

const TRANSITIONS: Record<
  AlertAction,
  { from: readonly AlertStatus[]; to: AlertStatus }
> = {
  ACKNOWLEDGE: { from: ["OPEN"], to: "ACKNOWLEDGED" },
  START: { from: ["ACKNOWLEDGED"], to: "IN_PROGRESS" },
  CLOSE: { from: ["ACKNOWLEDGED", "IN_PROGRESS"], to: "CLOSED" },
  CANCEL: { from: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"], to: "CANCELLED" },
};

export function isActive(status: AlertStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function targetOf(action: AlertAction): AlertStatus {
  return TRANSITIONS[action].to;
}

/** Actions that are possible from a state (before permissions). */
export function availableActions(status: AlertStatus): AlertAction[] {
  return (Object.keys(TRANSITIONS) as AlertAction[]).filter((action) =>
    TRANSITIONS[action].from.includes(status),
  );
}

/** Closing and cancelling require a note (the outcome or the reason). */
export function requiresNote(action: AlertAction): boolean {
  return action === "CLOSE" || action === "CANCEL";
}

export type TransitionInput = {
  action: AlertAction;
  /** State the user saw when acting; protects against acting on stale data. */
  expectedStatus: AlertStatus;
  current: AlertStatus;
  note: string;
  /** Explicit confirmation, so an acknowledgement is never accidental. */
  confirmed: boolean;
  canManage: boolean;
  isAuthor: boolean;
};

/** Null when allowed, otherwise a message for the user. */
export function checkTransition(input: TransitionInput): string | null {
  const allowedBy =
    input.action === "CANCEL"
      ? input.canManage || input.isAuthor
      : input.canManage;
  if (!allowedBy) return "Você não tem permissão para esta operação.";
  if (input.current !== input.expectedStatus) {
    return `O alerta mudou para "${ALERT_STATUS_LABELS[input.current]}" enquanto você olhava. Confira antes de agir.`;
  }
  if (!TRANSITIONS[input.action].from.includes(input.current)) {
    return `Não é possível ${ALERT_ACTION_LABELS[input.action].toLowerCase()} um alerta "${ALERT_STATUS_LABELS[input.current].toLowerCase()}".`;
  }
  if (!input.confirmed)
    return "Confirme a ação marcando a caixa de confirmação.";
  if (
    requiresNote(input.action) &&
    input.note.trim().length < MIN_NOTE_LENGTH
  ) {
    return input.action === "CLOSE"
      ? `Descreva o resultado do atendimento (mínimo de ${MIN_NOTE_LENGTH} caracteres).`
      : `Informe o motivo do cancelamento (mínimo de ${MIN_NOTE_LENGTH} caracteres).`;
  }
  return null;
}

export type CreatePlan =
  | { type: "create" }
  | { type: "already-stored" }
  | {
      type: "error";
      httpStatus: 403 | 409;
      code: string;
      message: string;
      /** The active alert of the post, when the refusal is a likely duplicate. */
      activeAlertId?: string;
    };

/**
 * Creation: idempotent by id; a second active alert for the same post is
 * refused unless the user confirms it is a different need (OD-37).
 */
export function planCreate(input: {
  canCreate: boolean;
  actorId: string;
  existing: { authorId: string; postId: string; description: string } | null;
  postId: string;
  description: string;
  activeOnPost: { id: string } | null;
  allowAnotherActive: boolean;
}): CreatePlan {
  if (input.existing) {
    const same =
      input.existing.authorId === input.actorId &&
      input.existing.postId === input.postId &&
      input.existing.description === input.description;
    return same
      ? { type: "already-stored" }
      : {
          type: "error",
          httpStatus: 409,
          code: "ID_CONFLICT",
          message: "Identificador de alerta já usado com outros dados.",
        };
  }
  if (!input.canCreate) {
    return {
      type: "error",
      httpStatus: 403,
      code: "FORBIDDEN",
      message: "Somente o capitão deste posto pode enviar alerta de reforço.",
    };
  }
  if (input.activeOnPost && !input.allowAnotherActive) {
    return {
      type: "error",
      httpStatus: 409,
      code: "ACTIVE_ALERT_EXISTS",
      message:
        "Já existe um alerta ativo deste posto. Se for outra necessidade, confirme o envio de um novo alerta.",
      activeAlertId: input.activeOnPost.id,
    };
  }
  return { type: "create" };
}

/** Minutes without acknowledgement, for highlighting. */
export function minutesWaiting(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60000));
}
