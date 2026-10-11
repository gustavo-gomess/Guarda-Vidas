import { z } from "zod";

import { postIdSchema } from "@/features/posts/schemas";

const label = z
  .string()
  .trim()
  .min(2, "Informe o nome do item.")
  .max(120, "Use no máximo 120 caracteres.");
const guidance = z.string().trim().max(300, "Use no máximo 300 caracteres.");
const position = z.coerce
  .number("Informe a ordem.")
  .int("Use um número inteiro.")
  .min(1, "A ordem começa em 1.")
  .max(999, "Use até 999.");

export const createItemSchema = z.object({
  postId: postIdSchema,
  label,
  guidance,
  position,
});

export const updateItemSchema = z.object({
  itemId: z.uuid("Item inválido."),
  label,
  guidance,
  position,
});

export const setItemActiveSchema = z.object({
  itemId: z.uuid("Item inválido."),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const startChecklistSchema = z.object({
  journeyId: z.uuid("Jornada inválida."),
});

/** Sent by the checklist screen as an object (not a form). */
export const saveChecklistSchema = z.object({
  checklistId: z.uuid("Checklist inválido."),
  /** New for every attempt chain; repeated on retries of the same save. */
  requestId: z.uuid("Envio inválido."),
  answers: z
    .array(
      z.object({
        lineId: z.uuid(),
        state: z.enum(["OK", "MISSING", "DAMAGED", "INADEQUATE"]).nullable(),
        note: z.string().max(300, "Use no máximo 300 caracteres por item."),
      }),
    )
    .max(300),
  generalNote: z.string().max(1000, "Use no máximo 1000 caracteres."),
  submit: z.boolean(),
  reason: z.string().max(500, "Use no máximo 500 caracteres."),
});

export type SaveChecklistPayload = z.input<typeof saveChecklistSchema>;
