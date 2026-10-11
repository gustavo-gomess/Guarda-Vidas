import { z } from "zod";

/**
 * Configurable fields of an occurrence category, kept deliberately small:
 * four simple types and at most MAX_FIELDS per category, so the form never
 * becomes complex. There is no field type for personal data: victims'
 * data needs an approved legal basis first (OD-19).
 */

export const FIELD_TYPES = ["text", "number", "choice", "yesno"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Texto curto",
  number: "Número",
  choice: "Lista de opções",
  yesno: "Sim ou não",
};

export const MAX_FIELDS = 8;
export const MAX_TEXT = 300;
export const MAX_NUMBER = 1_000_000;

export const fieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Chave de campo inválida."),
    label: z
      .string()
      .trim()
      .min(2, "Dê um nome ao campo.")
      .max(60, "Nome do campo com no máximo 60 caracteres."),
    type: z.enum(FIELD_TYPES, { error: "Tipo de campo inválido." }),
    required: z.boolean(),
    options: z
      .array(z.string().trim().min(1).max(40))
      .max(20, "No máximo 20 opções.")
      .default([]),
  })
  .refine((field) => field.type !== "choice" || field.options.length >= 2, {
    message: "Uma lista precisa de pelo menos 2 opções.",
    path: ["options"],
  });

export type FieldDefinition = z.infer<typeof fieldSchema>;

export const fieldsSchema = z
  .array(fieldSchema)
  .max(MAX_FIELDS, `No máximo ${MAX_FIELDS} campos por categoria.`)
  .refine(
    (fields) =>
      new Set(fields.map((field) => field.key)).size === fields.length,
    "Dois campos com a mesma chave.",
  );

/** Stable key from a label: "Nº de vítimas" -> "n_de_vitimas". */
export function keyFromLabel(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `campo_${base}`.slice(0, 40);
}

export type FieldValue = string | number | boolean | null;

/**
 * Checks the values sent for a category version. Unknown keys are dropped;
 * missing optional values become null. Returns field errors by key.
 */
export function validateValues(
  fields: readonly FieldDefinition[],
  raw: Record<string, unknown>,
): { values: Record<string, FieldValue>; errors: Record<string, string> } {
  const values: Record<string, FieldValue> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const input = raw[field.key];
    const empty =
      input === undefined || input === null || String(input).trim() === "";
    if (empty) {
      if (field.required) errors[field.key] = `Preencha "${field.label}".`;
      values[field.key] = null;
      continue;
    }
    switch (field.type) {
      case "text": {
        const text = String(input).trim();
        if (text.length > MAX_TEXT) {
          errors[field.key] =
            `"${field.label}" com no máximo ${MAX_TEXT} caracteres.`;
        }
        values[field.key] = text.slice(0, MAX_TEXT);
        break;
      }
      case "number": {
        const number = Number(String(input).replace(",", "."));
        if (!Number.isFinite(number) || number < 0 || number > MAX_NUMBER) {
          errors[field.key] =
            `"${field.label}" deve ser um número entre 0 e ${MAX_NUMBER}.`;
          values[field.key] = null;
        } else {
          values[field.key] = number;
        }
        break;
      }
      case "choice": {
        const choice = String(input);
        if (!field.options.includes(choice)) {
          errors[field.key] = `Escolha uma opção válida em "${field.label}".`;
          values[field.key] = null;
        } else {
          values[field.key] = choice;
        }
        break;
      }
      case "yesno": {
        if (input === true || input === "sim") values[field.key] = true;
        else if (input === false || input === "nao") values[field.key] = false;
        else {
          errors[field.key] = `Responda sim ou não em "${field.label}".`;
          values[field.key] = null;
        }
        break;
      }
    }
  }
  return { values, errors };
}

/** Human-readable value for lists and history. */
export function formatValue(field: FieldDefinition, value: FieldValue): string {
  if (value === null || value === undefined) return "—";
  if (field.type === "yesno") return value ? "Sim" : "Não";
  return String(value);
}
