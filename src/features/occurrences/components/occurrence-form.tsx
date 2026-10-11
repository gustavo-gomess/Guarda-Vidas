"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { createOccurrenceAction } from "@/features/occurrences/actions";
import type { FieldDefinition } from "@/features/occurrences/fields";
import { formatDateTime } from "@/lib/dates";

type Category = {
  id: string;
  name: string;
  description: string;
  fields: FieldDefinition[];
};

type Message =
  | { tone: "ok"; text: string; id: string }
  | { tone: "error" | "warn"; text: string }
  | null;

const inputClass =
  "rounded-md border border-zinc-300 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900";

/** "YYYY-MM-DDTHH:mm" in the device's local time, for datetime-local. */
function localNow() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Registers an operational record. Online only (OD-40): if the connection
 * fails nothing is stored and the data stay on screen; the retry reuses the
 * same id, so the server never stores it twice.
 */
export function OccurrenceForm({
  posts,
  categories,
}: {
  posts: { id: string; code: string; name: string }[];
  categories: Category[];
}) {
  const [postId, setPostId] = useState(posts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const recordId = useRef<string | null>(null);

  const category = categories.find((entry) => entry.id === categoryId);

  function edited() {
    recordId.current = null;
  }

  async function submit() {
    setPending(true);
    setMessage(null);
    setFieldErrors({});
    recordId.current ??= crypto.randomUUID();
    try {
      const result = await createOccurrenceAction({
        id: recordId.current,
        postId,
        categoryId,
        occurredAt: new Date(occurredAt).toISOString(),
        description,
        values,
      });
      if (result.ok) {
        setMessage({
          tone: "ok",
          id: result.data.id,
          text: result.data.alreadySaved
            ? "Este registro já tinha chegado ao servidor; nada foi duplicado."
            : `Registrado no servidor às ${formatDateTime(new Date(result.data.recordedAt))}.`,
        });
        recordId.current = null;
        setDescription("");
        setValues({});
        setOccurredAt(localNow());
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        setMessage({ tone: "error", text: result.error });
      }
    } catch {
      setMessage({
        tone: "warn",
        text: "Sem conexão com o servidor: NADA foi registrado. Os dados continuam nesta tela; tente novamente quando a conexão voltar.",
      });
    } finally {
      setPending(false);
    }
  }

  if (categories.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        Nenhuma categoria de registro configurada. Avise um administrador.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="rounded-md border border-amber-600 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        Não registre nome, documento, telefone ou dados de saúde de vítimas: a
        coleta desses dados ainda não foi aprovada (LGPD).
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Posto</span>
          <select
            value={postId}
            onChange={(event) => {
              setPostId(event.target.value);
              edited();
            }}
            className={inputClass}
          >
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.code} · {post.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Categoria</span>
          <select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setValues({});
              edited();
            }}
            className={inputClass}
          >
            {categories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Quando aconteceu</span>
          <input
            type="datetime-local"
            value={occurredAt}
            required
            onChange={(event) => {
              setOccurredAt(event.target.value);
              edited();
            }}
            className={inputClass}
          />
        </label>
      </div>
      {category?.description ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {category.description}
        </p>
      ) : null}

      {category?.fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            {field.label}
            {field.required ? " (obrigatório)" : ""}
          </span>
          {field.type === "choice" || field.type === "yesno" ? (
            <select
              value={values[field.key] ?? ""}
              onChange={(event) => {
                setValues({ ...values, [field.key]: event.target.value });
                edited();
              }}
              className={inputClass}
            >
              <option value="">—</option>
              {(field.type === "yesno"
                ? [
                    { value: "sim", label: "Sim" },
                    { value: "nao", label: "Não" },
                  ]
                : field.options.map((option) => ({
                    value: option,
                    label: option,
                  }))
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              inputMode={field.type === "number" ? "decimal" : undefined}
              value={values[field.key] ?? ""}
              maxLength={300}
              onChange={(event) => {
                setValues({ ...values, [field.key]: event.target.value });
                edited();
              }}
              className={inputClass}
            />
          )}
          {fieldErrors[field.key] ? (
            <span className="text-red-700 dark:text-red-400">
              {fieldErrors[field.key]![0]}
            </span>
          ) : null}
        </label>
      ))}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Descrição</span>
        <textarea
          value={description}
          rows={4}
          maxLength={2000}
          onChange={(event) => {
            setDescription(event.target.value);
            edited();
          }}
          className={inputClass}
        />
      </label>

      <button
        type="submit"
        disabled={pending || !postId || !categoryId}
        className="self-start rounded-md bg-zinc-900 px-5 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Registrando…" : "Registrar"}
      </button>
      {message ? (
        <p
          role="alert"
          className={`rounded-md border px-3 py-2 text-sm ${
            message.tone === "ok"
              ? "border-green-600 text-green-800 dark:text-green-300"
              : message.tone === "warn"
                ? "border-amber-600 text-amber-800 dark:text-amber-300"
                : "border-red-600 text-red-800 dark:text-red-300"
          }`}
        >
          {message.text}{" "}
          {message.tone === "ok" ? (
            <Link href={`/ocorrencias/${message.id}`} className="underline">
              Ver registro
            </Link>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
