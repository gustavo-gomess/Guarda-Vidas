import {
  validateValues,
  type FieldDefinition,
  type FieldValue,
} from "@/features/occurrences/fields";

/**
 * Occurrence rules, free of Next.js and the database.
 * Provisional (docs/OPEN-DECISIONS.md, OD-39, OD-40): who registers, the
 * time limits and the annulment.
 */

/** A device clock slightly ahead is tolerated; more is an error. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type OccurrencePlan =
  | { type: "create"; values: Record<string, FieldValue> }
  | { type: "already-stored" }
  | { type: "error"; message: string; fieldErrors?: Record<string, string[]> };

export function planOccurrence(input: {
  actorId: string;
  canRecord: boolean;
  existing: { authorId: string } | null;
  category: { active: boolean; fields: readonly FieldDefinition[] } | null;
  rawValues: Record<string, unknown>;
  occurredAt: Date;
  now: Date;
}): OccurrencePlan {
  if (input.existing) {
    return input.existing.authorId === input.actorId
      ? { type: "already-stored" }
      : { type: "error", message: "Identificador de registro inválido." };
  }
  if (!input.canRecord) {
    return {
      type: "error",
      message: "Somente guarda-vidas da equipe do posto registram ocorrências.",
    };
  }
  if (!input.category || !input.category.active) {
    return { type: "error", message: "Categoria inexistente ou desativada." };
  }
  if (input.occurredAt.getTime() > input.now.getTime() + FUTURE_TOLERANCE_MS) {
    return {
      type: "error",
      message: "A data e hora informadas estão no futuro.",
      fieldErrors: {
        occurredAt: ["Informe quando aconteceu (não no futuro)."],
      },
    };
  }
  const { values, errors } = validateValues(
    input.category.fields,
    input.rawValues,
  );
  if (Object.keys(errors).length > 0) {
    return {
      type: "error",
      message: "Confira os campos destacados.",
      fieldErrors: Object.fromEntries(
        Object.entries(errors).map(([key, message]) => [key, [message]]),
      ),
    };
  }
  return { type: "create", values };
}

export type CategoryContent = {
  name: string;
  description: string;
  active: boolean;
  fields: readonly FieldDefinition[];
};

export function categoryChanged(
  a: CategoryContent,
  b: CategoryContent,
): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
