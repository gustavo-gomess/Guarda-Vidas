import { z } from "zod";

import { MAX_DESCRIPTION } from "@/features/alerts/rules";

/** Sent by the alert screen as JSON to POST /api/alertas. */
export const createAlertSchema = z.object({
  id: z.uuid("Identificador inválido."),
  postId: z.uuid("Posto inválido."),
  description: z
    .string()
    .trim()
    .min(5, "Descreva a necessidade (mínimo de 5 caracteres).")
    .max(MAX_DESCRIPTION, `Use no máximo ${MAX_DESCRIPTION} caracteres.`),
  deviceTime: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  /** The user confirmed it is a different need from the active alert. */
  allowAnotherActive: z.boolean().default(false),
});

export type CreateAlertPayload = z.input<typeof createAlertSchema>;

export const transitionSchema = z.object({
  alertId: z.uuid("Alerta inválido."),
  action: z.enum(["ACKNOWLEDGE", "START", "CLOSE", "CANCEL"], {
    error: "Ação inválida.",
  }),
  expectedStatus: z.enum(
    ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "CLOSED", "CANCELLED"],
    { error: "Estado inválido." },
  ),
  note: z.string().trim().max(500, "Use no máximo 500 caracteres."),
  confirmed: z.literal("on").optional(),
});
