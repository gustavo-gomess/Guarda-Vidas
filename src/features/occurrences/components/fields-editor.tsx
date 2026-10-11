"use client";

import { useState } from "react";

import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  keyFromLabel,
  MAX_FIELDS,
  type FieldDefinition,
  type FieldType,
} from "@/features/occurrences/fields";

const inputClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

/**
 * Edits the fields of a category and sends them as JSON in a hidden input
 * named "fields". Keys of existing fields never change, so reports keep
 * matching old and new versions. The server validates everything again.
 */
export function FieldsEditor({ initial }: { initial: FieldDefinition[] }) {
  const [fields, setFields] = useState<FieldDefinition[]>(initial);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");

  function update(index: number, change: Partial<FieldDefinition>) {
    setFields(
      fields.map((field, i) => (i === index ? { ...field, ...change } : field)),
    );
  }

  function add() {
    const base = keyFromLabel(label);
    let key = base;
    for (let n = 2; fields.some((field) => field.key === key); n++)
      key = `${base}_${n}`;
    setFields([
      ...fields,
      { key, label: label.trim(), type, required: false, options: [] },
    ]);
    setLabel("");
  }

  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="font-medium">
        Campos (até {MAX_FIELDS}; não crie campos para dados pessoais de
        vítimas)
      </legend>
      <input type="hidden" name="fields" value={JSON.stringify(fields)} />
      {fields.length === 0 ? (
        <p className="text-zinc-500">
          Sem campos extras: só data, hora e descrição.
        </p>
      ) : null}
      {fields.map((field, index) => (
        <div key={field.key} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span>Nome</span>
            <input
              value={field.label}
              maxLength={60}
              onChange={(event) => update(index, { label: event.target.value })}
              className={inputClass}
            />
          </label>
          <span className="py-1 text-zinc-500">
            {FIELD_TYPE_LABELS[field.type]}
          </span>
          {field.type === "choice" ? (
            <label className="flex flex-col gap-1">
              <span>Opções (separadas por ;)</span>
              <input
                value={field.options.join("; ")}
                onChange={(event) =>
                  update(index, {
                    options: event.target.value
                      .split(";")
                      .map((option) => option.trim())
                      .filter(Boolean),
                  })
                }
                className={inputClass}
              />
            </label>
          ) : null}
          <label className="flex items-center gap-1 py-1">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(event) =>
                update(index, { required: event.target.checked })
              }
            />
            Obrigatório
          </label>
          <button
            type="button"
            onClick={() => setFields(fields.filter((_, i) => i !== index))}
            className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700"
          >
            Remover
          </button>
        </div>
      ))}
      {fields.length < MAX_FIELDS ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span>Novo campo</span>
            <input
              value={label}
              maxLength={60}
              onChange={(event) => setLabel(event.target.value)}
              className={inputClass}
            />
          </label>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as FieldType)}
            className={inputClass}
          >
            {FIELD_TYPES.map((value) => (
              <option key={value} value={value}>
                {FIELD_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={label.trim().length < 2}
            onClick={add}
            className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
          >
            Adicionar campo
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
