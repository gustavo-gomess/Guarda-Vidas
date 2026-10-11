import { describe, expect, it } from "vitest";

import {
  fieldsSchema,
  keyFromLabel,
  validateValues,
  type FieldDefinition,
} from "@/features/occurrences/fields";
import { categoryChanged, planOccurrence } from "@/features/occurrences/rules";

const fields: FieldDefinition[] = [
  {
    key: "especie",
    label: "Espécie",
    type: "choice",
    required: true,
    options: ["Caravela", "Água-viva"],
  },
  {
    key: "quantidade",
    label: "Quantidade",
    type: "number",
    required: true,
    options: [],
  },
  {
    key: "bandeira",
    label: "Bandeira trocada",
    type: "yesno",
    required: false,
    options: [],
  },
  { key: "local", label: "Local", type: "text", required: false, options: [] },
];

describe("configurable fields", () => {
  it("validates and converts each type, dropping unknown keys", () => {
    expect(
      validateValues(fields, {
        especie: "Caravela",
        quantidade: "12,5",
        bandeira: "sim",
        local: "  Canto norte ",
        nome_da_vitima: "Fulano",
      }),
    ).toEqual({
      values: {
        especie: "Caravela",
        quantidade: 12.5,
        bandeira: true,
        local: "Canto norte",
      },
      errors: {},
    });
  });

  it("reports required, invalid choices and numbers", () => {
    const { errors } = validateValues(fields, {
      especie: "Tubarão",
      quantidade: "-3",
    });
    expect(Object.keys(errors).sort()).toEqual(["especie", "quantidade"]);
    expect(validateValues(fields, {}).errors).toMatchObject({
      especie: 'Preencha "Espécie".',
      quantidade: 'Preencha "Quantidade".',
    });
  });

  it("keeps the form small and keys unique", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      key: `campo_${i}`,
      label: `Campo ${i}`,
      type: "text",
      required: false,
      options: [],
    }));
    expect(fieldsSchema.safeParse(many).success).toBe(false);
    expect(fieldsSchema.safeParse([fields[0], fields[0]]).success).toBe(false);
    expect(
      fieldsSchema.safeParse([{ ...fields[0], options: ["Só uma"] }]).success,
    ).toBe(false);
  });

  it("makes stable keys from labels", () => {
    expect(keyFromLabel("Nº de águas-vivas")).toBe("n_de_aguas_vivas");
    expect(keyFromLabel("2 bandeiras")).toBe("campo_2_bandeiras");
  });

  it("detects category changes (new version)", () => {
    const base = { name: "Águas-vivas", description: "", active: true, fields };
    expect(categoryChanged(base, { ...base, fields: [...fields] })).toBe(false);
    expect(categoryChanged(base, { ...base, active: false })).toBe(true);
  });
});

describe("registering", () => {
  const now = new Date("2026-10-12T13:00:00Z");
  const base = {
    actorId: "lg",
    canRecord: true,
    existing: null,
    category: { active: true, fields },
    rawValues: { especie: "Caravela", quantidade: "3" },
    occurredAt: new Date("2026-10-12T12:30:00Z"),
    now,
  };

  it("creates with validated values", () => {
    expect(planOccurrence(base)).toEqual({
      type: "create",
      values: {
        especie: "Caravela",
        quantidade: 3,
        bandeira: null,
        local: null,
      },
    });
  });

  it("is idempotent for the same author and refuses a foreign id", () => {
    expect(planOccurrence({ ...base, existing: { authorId: "lg" } })).toEqual({
      type: "already-stored",
    });
    expect(
      planOccurrence({ ...base, existing: { authorId: "other" } }),
    ).toMatchObject({
      type: "error",
    });
  });

  it("refuses outsiders, inactive categories and future times", () => {
    expect(planOccurrence({ ...base, canRecord: false })).toMatchObject({
      type: "error",
    });
    expect(
      planOccurrence({ ...base, category: { active: false, fields } }),
    ).toMatchObject({ type: "error" });
    expect(
      planOccurrence({ ...base, occurredAt: new Date("2026-10-12T14:00:00Z") }),
    ).toMatchObject({
      type: "error",
      fieldErrors: { occurredAt: [expect.any(String)] },
    });
  });

  it("returns field errors by key", () => {
    expect(planOccurrence({ ...base, rawValues: {} })).toMatchObject({
      type: "error",
      fieldErrors: {
        especie: [expect.any(String)],
        quantidade: [expect.any(String)],
      },
    });
  });
});
