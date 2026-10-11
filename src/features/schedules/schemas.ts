import { z } from "zod";

import { isoDateSchema, windowIdSchema } from "@/features/availability/schemas";
import { postIdSchema } from "@/features/posts/schemas";
import { addDays, daysBetween, isIsoDate } from "@/lib/dates";

export const scheduleIdSchema = z.uuid("Escala inválida.");

const reasonSchema = z
  .string()
  .trim()
  .max(500, "Use no máximo 500 caracteres.");

export const createScheduleSchema = z.object({
  postId: postIdSchema,
  windowId: windowIdSchema,
});

export const addEntrySchema = z.object({
  scheduleId: scheduleIdSchema,
  userId: z.uuid("Escolha um guarda-vidas."),
  date: isoDateSchema,
  reason: reasonSchema,
});

export const removeEntrySchema = z.object({
  entryId: z.uuid("Registro inválido."),
  reason: reasonSchema,
});

export const confirmScheduleSchema = z.object({ scheduleId: scheduleIdSchema });

export const MAX_FILTER_DAYS = 62;
export const DEFAULT_FILTER_DAYS = 14;

export type ScheduleFilters = {
  from: string;
  to: string;
  postId?: string;
  userId?: string;
};

/** Raw search params ("de", "ate", "posto", "profissional") to filters. */
export function parseScheduleFilters(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { filters: ScheduleFilters; errors: string[] } {
  const value = (key: string) => {
    const raw = params[key];
    const text = Array.isArray(raw) ? raw[0] : raw;
    return text ? text.trim() : undefined;
  };
  const errors: string[] = [];

  const rawFrom = value("de");
  const rawTo = value("ate");
  let from = rawFrom && isIsoDate(rawFrom) ? rawFrom : today;
  if (rawFrom && from !== rawFrom) errors.push("Data inicial inválida.");
  let to =
    rawTo && isIsoDate(rawTo) ? rawTo : addDays(from, DEFAULT_FILTER_DAYS - 1);
  if (rawTo && to !== rawTo) errors.push("Data final inválida.");
  if (to < from) {
    errors.push("A data final é anterior à inicial; as datas foram trocadas.");
    [from, to] = [to, from];
  }
  if (daysBetween(from, to) >= MAX_FILTER_DAYS) {
    errors.push(`O período foi limitado a ${MAX_FILTER_DAYS} dias.`);
    to = addDays(from, MAX_FILTER_DAYS - 1);
  }

  const uuid = (key: string, label: string) => {
    const raw = value(key);
    if (!raw) return undefined;
    if (z.uuid().safeParse(raw).success) return raw;
    errors.push(`${label} inválido no filtro.`);
    return undefined;
  };

  return {
    filters: {
      from,
      to,
      postId: uuid("posto", "Posto"),
      userId: uuid("profissional", "Profissional"),
    },
    errors,
  };
}
