import type { PostStatus } from "@/features/posts/status";
import { addDays, daysBetween } from "@/lib/dates";

/**
 * Scheduling rules, free of Next.js and the database so they can be tested
 * directly. Dates are operational calendar dates ("YYYY-MM-DD").
 *
 * Approved: availability windows of three consecutive days; the coordinator
 * builds and confirms schedules; one shift per day; never two posts at once.
 * Provisional (docs/OPEN-DECISIONS.md, OD-08, OD-24..OD-27): see each rule.
 */

export const WINDOW_DAYS = 3;
export const MIN_REASON_LENGTH = 5;

export type ScheduleStatus = "PROPOSED" | "CONFIRMED" | "CHANGED";
export type WindowStatus = "OPEN" | "CLOSED";
export type AvailabilityAnswer = "AVAILABLE" | "UNAVAILABLE" | "NOT_SENT";

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  PROPOSED: "Proposta (não publicada)",
  CONFIRMED: "Confirmada",
  CHANGED: "Alterada após confirmação",
};

export const WINDOW_STATUS_LABELS: Record<WindowStatus, string> = {
  OPEN: "Aberta para disponibilidade",
  CLOSED: "Encerrada",
};

export const AVAILABILITY_LABELS: Record<AvailabilityAnswer, string> = {
  AVAILABLE: "disponível",
  UNAVAILABLE: "indisponível",
  NOT_SENT: "não enviou disponibilidade",
};

// --- Windows -----------------------------------------------------------------

export function windowDays(startDate: string): string[] {
  return Array.from({ length: WINDOW_DAYS }, (_, day) =>
    addDays(startDate, day),
  );
}

export function windowEnd(startDate: string): string {
  return addDays(startDate, WINDOW_DAYS - 1);
}

export function isInWindow(startDate: string, date: string): boolean {
  const offset = daysBetween(startDate, date);
  return offset >= 0 && offset < WINDOW_DAYS;
}

export function windowsOverlap(startA: string, startB: string): boolean {
  return Math.abs(daysBetween(startA, startB)) < WINDOW_DAYS;
}

/**
 * Provisional (OD-08): windows start today or later and never overlap, so
 * each day belongs to at most one window.
 */
export function checkOpenWindow(input: {
  startDate: string;
  today: string;
  existingStartDates: readonly string[];
}): string | null {
  if (input.startDate < input.today) {
    return "A janela não pode começar em um dia que já passou.";
  }
  const overlapping = input.existingStartDates.some((start) =>
    windowsOverlap(start, input.startDate),
  );
  if (overlapping) {
    return "Já existe uma janela que cobre algum desses dias.";
  }
  return null;
}

// --- Availability ------------------------------------------------------------

export type AvailabilityDays = { day1: boolean; day2: boolean; day3: boolean };

export function availabilityOn(
  submission: AvailabilityDays | null,
  windowStart: string,
  date: string,
): AvailabilityAnswer {
  if (!submission || !isInWindow(windowStart, date)) return "NOT_SENT";
  const days = [submission.day1, submission.day2, submission.day3];
  return days[daysBetween(windowStart, date)] ? "AVAILABLE" : "UNAVAILABLE";
}

export function checkSubmitAvailability(
  windowStatus: WindowStatus,
): string | null {
  return windowStatus === "OPEN"
    ? null
    : "Esta janela está encerrada e não aceita mais disponibilidade.";
}

// --- Schedules ---------------------------------------------------------------

/** Published schedules are the only ones lifeguards see. */
export function isPublished(status: ScheduleStatus): boolean {
  return status !== "PROPOSED";
}

/** Any change to a published schedule makes it "changed". */
export function statusAfterChange(status: ScheduleStatus): ScheduleStatus {
  return status === "PROPOSED" ? "PROPOSED" : "CHANGED";
}

/**
 * A justification is required to change a published schedule and
 * (provisional, OD-25) to schedule someone not declared available that day.
 */
export function reasonRequiredForAdd(
  status: ScheduleStatus,
  availability: AvailabilityAnswer,
): boolean {
  return isPublished(status) || availability !== "AVAILABLE";
}

export function reasonRequiredForRemove(status: ScheduleStatus): boolean {
  return isPublished(status);
}

function missingReason(required: boolean, reason: string): boolean {
  return required && reason.trim().length < MIN_REASON_LENGTH;
}

const REASON_MESSAGE = `Informe uma justificativa (mínimo de ${MIN_REASON_LENGTH} caracteres).`;

export type ExistingEntry = { postName: string; samePost: boolean };

export type AddEntryInput = {
  scheduleStatus: ScheduleStatus;
  windowStart: string;
  postStatus: PostStatus;
  date: string;
  today: string;
  target: { role: string; active: boolean; inTeam: boolean } | null;
  /** The target's entry on the same date, in any post and schedule state. */
  existing: ExistingEntry | null;
  availability: AvailabilityAnswer;
  reason: string;
};

/** Null when the entry may be added, otherwise a message for the user. */
export function checkAddEntry(input: AddEntryInput): string | null {
  const { target } = input;
  if (!target || target.role !== "LIFEGUARD" || !target.active) {
    return "Escolha um guarda-vidas ativo.";
  }
  // Provisional (OD-26): only the post's team can be scheduled there.
  if (!target.inTeam) {
    return "Este guarda-vidas não faz parte da equipe do posto.";
  }
  if (input.postStatus !== "OPERATING") {
    return "O posto não está em operação; não é possível escalar.";
  }
  if (!isInWindow(input.windowStart, input.date)) {
    return "A data está fora dos três dias desta escala.";
  }
  // Provisional (OD-25): past days are history and cannot be changed.
  if (input.date < input.today) {
    return "Não é possível alterar a escala de dias que já passaram.";
  }
  if (input.existing) {
    return input.existing.samePost
      ? "Este guarda-vidas já está escalado neste posto neste dia."
      : `Conflito: este guarda-vidas já está escalado no posto ${input.existing.postName} neste dia.`;
  }
  if (
    missingReason(
      reasonRequiredForAdd(input.scheduleStatus, input.availability),
      input.reason,
    )
  ) {
    return isPublished(input.scheduleStatus)
      ? `A escala já foi confirmada. ${REASON_MESSAGE}`
      : `O guarda-vidas não declarou disponibilidade para este dia. ${REASON_MESSAGE}`;
  }
  return null;
}

export function checkRemoveEntry(input: {
  scheduleStatus: ScheduleStatus;
  date: string;
  today: string;
  reason: string;
}): string | null {
  if (input.date < input.today) {
    return "Não é possível alterar a escala de dias que já passaram.";
  }
  if (
    missingReason(reasonRequiredForRemove(input.scheduleStatus), input.reason)
  ) {
    return `A escala já foi confirmada. ${REASON_MESSAGE}`;
  }
  return null;
}

/** Confirmation is always a coordinator's explicit act on a proposal. */
export function checkConfirm(input: {
  status: ScheduleStatus;
  entryCount: number;
}): string | null {
  if (input.status !== "PROPOSED") return "Esta escala já foi confirmada.";
  if (input.entryCount === 0) {
    return "Inclua pelo menos um guarda-vidas antes de confirmar.";
  }
  return null;
}
