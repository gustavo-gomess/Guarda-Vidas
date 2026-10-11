/**
 * Calendar dates of the operation, as "YYYY-MM-DD" strings.
 *
 * Provisional (OD-05): the operational day follows America/Sao_Paulo.
 * Database DATE columns travel as Date objects at UTC midnight; convert with
 * toDbDate / fromDbDate and never use local time.
 */
export const OPERATIONAL_TIME_ZONE = "America/Sao_Paulo";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPERATIONAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && fromDbDate(date) === value;
}

/** Today's operational date at the instant `now`. */
export function operationalToday(now: Date): string {
  return isoFormat.format(now);
}

export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return fromDbDate(new Date(toDbDate(isoDate).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS,
  );
}

const displayFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** e.g. "seg., 12/10/2026". */
export function formatIsoDate(isoDate: string): string {
  return displayFormat.format(toDbDate(isoDate));
}

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: OPERATIONAL_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

/** An instant in operational time, e.g. "12/10/2026, 14:30". */
export function formatDateTime(instant: Date): string {
  return dateTimeFormat.format(instant);
}
