"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { saveChecklistAction } from "@/features/checklists/actions";
import {
  ITEM_STATE_LABELS,
  ITEM_STATES,
  MIN_REASON_LENGTH,
  REVISION_LABELS,
  type ItemState,
} from "@/features/checklists/rules";

type Line = { id: string; label: string; guidance: string };
type AnswerValue = { state: ItemState | null; note: string };

export type ChecklistFormProps = {
  checklistId: string;
  submitted: boolean;
  lines: Line[];
  current: {
    generalNote: string;
    answers: { lineId: string; state: ItemState | null; note: string }[];
  } | null;
};

type Message = { tone: "ok" | "warn" | "error"; text: string } | null;

const toneClass = {
  ok: "border-green-600 text-green-800 dark:text-green-300",
  warn: "border-amber-600 text-amber-800 dark:text-amber-300",
  error: "border-red-600 text-red-800 dark:text-red-300",
};

const inputClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

/**
 * Fills, sends or corrects a checklist. Works online only (offline is not
 * approved, OD-35): if the connection fails, nothing is stored on the
 * device, the answers stay on screen and the retry reuses the same request
 * id, so the server never stores the same save twice.
 */
export function ChecklistForm({
  checklistId,
  submitted,
  lines,
  current,
}: ChecklistFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() =>
    Object.fromEntries(
      lines.map((line) => {
        const saved = current?.answers.find((a) => a.lineId === line.id);
        return [
          line.id,
          { state: saved?.state ?? null, note: saved?.note ?? "" },
        ];
      }),
    ),
  );
  const [generalNote, setGeneralNote] = useState(current?.generalNote ?? "");
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  // Same id for retries of an unconfirmed save; a new one after any edit.
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edited() {
    setDirty(true);
    requestId.current = null;
  }

  function setAnswer(lineId: string, change: Partial<AnswerValue>) {
    setAnswers((previous) => ({
      ...previous,
      [lineId]: { ...previous[lineId]!, ...change },
    }));
    edited();
  }

  const unanswered = lines.filter((line) => !answers[line.id]?.state).length;

  async function save(submit: boolean) {
    setPending(true);
    setMessage(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await saveChecklistAction({
        checklistId,
        requestId: requestId.current,
        answers: lines.map((line) => ({
          lineId: line.id,
          state: answers[line.id]?.state ?? null,
          note: answers[line.id]?.note ?? "",
        })),
        generalNote,
        submit,
        reason,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
      } else {
        requestId.current = null;
        setDirty(false);
        setReason("");
        const { kind, number, alreadySaved } = result.data;
        setMessage({
          tone: "ok",
          text: alreadySaved
            ? "Este envio já tinha chegado ao servidor; nada foi duplicado."
            : kind
              ? `${REVISION_LABELS[kind]} (versão ${number}), confirmado pelo servidor.`
              : "Nada mudou desde o último salvamento.",
        });
        router.refresh();
      }
    } catch {
      setMessage({
        tone: "warn",
        text: "Sem conexão com o servidor: NADA foi salvo. Suas respostas continuam nesta tela; tente novamente quando a conexão voltar. O checklist não fica guardado no aparelho.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <ol className="flex flex-col gap-4">
        {lines.map((line, index) => {
          const value = answers[line.id]!;
          return (
            <li
              key={line.id}
              className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <fieldset className="flex flex-col gap-2">
                <legend className="font-medium">
                  {index + 1}. {line.label}
                </legend>
                {line.guidance ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {line.guidance}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  {ITEM_STATES.map((state) => (
                    <label
                      key={state}
                      className="flex items-center gap-1 text-sm"
                    >
                      <input
                        type="radio"
                        name={`state-${line.id}`}
                        checked={value.state === state}
                        onChange={() => setAnswer(line.id, { state })}
                        className="size-5"
                      />
                      {ITEM_STATE_LABELS[state]}
                    </label>
                  ))}
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span>
                    Observação
                    {value.state && value.state !== "OK"
                      ? " (descreva o problema)"
                      : " (opcional)"}
                  </span>
                  <input
                    value={value.note}
                    maxLength={300}
                    onChange={(event) =>
                      setAnswer(line.id, { note: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>
              </fieldset>
            </li>
          );
        })}
      </ol>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Observações gerais do posto</span>
        <textarea
          value={generalNote}
          maxLength={1000}
          rows={3}
          onChange={(event) => {
            setGeneralNote(event.target.value);
            edited();
          }}
          className={inputClass}
        />
      </label>

      {submitted ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Motivo da correção (obrigatório, mínimo de {MIN_REASON_LENGTH}{" "}
            caracteres). A versão anterior continua no histórico.
          </span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            className={inputClass}
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {submitted ? (
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={() => void save(false)}
            className="rounded-md bg-zinc-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "Enviando…" : "Enviar correção"}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => void save(false)}
              className="rounded-md border border-zinc-400 px-4 py-2 disabled:opacity-40"
            >
              Salvar rascunho
            </button>
            <button
              type="button"
              disabled={pending || unanswered > 0}
              onClick={() => void save(true)}
              className="rounded-md bg-zinc-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? "Enviando…" : "Enviar checklist"}
            </button>
            {unanswered > 0 ? (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Faltam {unanswered} item(ns).
              </span>
            ) : null}
          </>
        )}
        {dirty ? (
          <span className="text-sm text-amber-700 dark:text-amber-400">
            Alterações não salvas.
          </span>
        ) : null}
      </div>
      {message ? (
        <p
          role="alert"
          className={`rounded-md border px-3 py-2 text-sm ${toneClass[message.tone]}`}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
