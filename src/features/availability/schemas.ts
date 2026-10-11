import { z } from "zod";

import { isIsoDate } from "@/lib/dates";

export const windowIdSchema = z.uuid("Janela inválida.");

export const isoDateSchema = z
  .string("Informe uma data.")
  .refine(isIsoDate, "Informe uma data válida.");

export const openWindowSchema = z.object({ startDate: isoDateSchema });

export const setWindowStatusSchema = z.object({
  windowId: windowIdSchema,
  status: z.enum(["OPEN", "CLOSED"], { error: "Situação inválida." }),
});

/** Checkboxes arrive as "on" when checked and are missing otherwise. */
const checkbox = z
  .union([z.literal("on"), z.null()])
  .transform((value) => value === "on");

export const submitAvailabilitySchema = z.object({
  windowId: windowIdSchema,
  day1: checkbox,
  day2: checkbox,
  day3: checkbox,
  note: z.string().trim().max(300, "Use no máximo 300 caracteres."),
});
