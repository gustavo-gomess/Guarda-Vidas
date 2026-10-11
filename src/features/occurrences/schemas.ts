import { z } from "zod";

import { fieldsSchema } from "@/features/occurrences/fields";

const name = z
  .string()
  .trim()
  .min(2, "Informe o nome da categoria.")
  .max(60, "Use no máximo 60 caracteres.");
const description = z.string().trim().max(300, "Use no máximo 300 caracteres.");

/** The fields arrive as JSON from the category editor. */
const fieldsJson = z
  .string()
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Campos inválidos." });
      return z.NEVER;
    }
  })
  .pipe(fieldsSchema);

export const createCategorySchema = z.object({
  name,
  description,
  fields: fieldsJson,
});

export const updateCategorySchema = createCategorySchema.extend({
  categoryId: z.uuid("Categoria inválida."),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/** Sent by the occurrence screen as an object. */
export const createOccurrenceSchema = z.object({
  id: z.uuid("Identificador inválido."),
  postId: z.uuid("Escolha o posto."),
  categoryId: z.uuid("Escolha a categoria."),
  occurredAt: z.iso
    .datetime({ offset: true, error: "Informe data e hora." })
    .transform((value) => new Date(value)),
  description: z.string().trim().max(2000, "Use no máximo 2000 caracteres."),
  values: z.record(z.string(), z.unknown()),
});

export type CreateOccurrencePayload = z.input<typeof createOccurrenceSchema>;

export const annulSchema = z.object({
  occurrenceId: z.uuid("Registro inválido."),
  reason: z
    .string()
    .trim()
    .min(5, "Informe o motivo da anulação (mínimo de 5 caracteres).")
    .max(500, "Use no máximo 500 caracteres."),
});
