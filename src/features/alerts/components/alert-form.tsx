"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";

import {
  sendAlert,
  type SendAlertOutcome,
} from "@/features/alerts/client/send-alert";
import {
  ALERT_STATUS_LABELS,
  MAX_DESCRIPTION,
  NOT_SENT_GUIDANCE,
  type AlertStatus,
} from "@/features/alerts/rules";
import { formatDateTime } from "@/lib/dates";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const NOT_SENT_DETAIL: Record<"network" | "server" | "session", string> = {
  network: "Sem conexão com o servidor.",
  server: "O servidor não conseguiu registrar o alerta.",
  session: "Sua sessão expirou; entre novamente para enviar pelo sistema.",
};

/**
 * Reinforcement alert form for the captain. Nothing is stored on the
 * device: an alert that did not reach the server was NOT sent, and the
 * screen says so and points to the official emergency channel.
 */
export function AlertForm({
  posts,
}: {
  posts: { id: string; code: string; name: string }[];
}) {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const [postId, setPostId] = useState(posts[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<SendAlertOutcome | null>(null);
  // Same id on retries of the same alert: the server never stores it twice.
  const alertId = useRef<string | null>(null);

  function edited() {
    alertId.current = null;
    setOutcome(null);
  }

  async function send(allowAnotherActive: boolean) {
    setPending(true);
    alertId.current ??= crypto.randomUUID();
    const result = await sendAlert({
      id: alertId.current,
      postId,
      description,
      deviceTime: new Date().toISOString(),
      allowAnotherActive,
    });
    setOutcome(result);
    if (result.kind === "stored") {
      alertId.current = null;
      setDescription("");
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {!online ? (
        <p
          role="alert"
          className="rounded-md border border-red-600 px-3 py-2 font-medium text-red-800 dark:text-red-300"
        >
          Sem conexão. {NOT_SENT_GUIDANCE}
        </p>
      ) : null}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
      >
        {posts.length > 1 ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Posto</span>
            <select
              value={postId}
              onChange={(event) => {
                setPostId(event.target.value);
                edited();
              }}
              className="rounded-md border border-zinc-300 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {posts.map((post) => (
                <option key={post.id} value={post.id}>
                  {post.code} · {post.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm">
            Posto:{" "}
            <strong>
              {posts[0]?.code} · {posts[0]?.name}
            </strong>
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Necessidade (o que e quanto reforço)
          </span>
          <textarea
            value={description}
            required
            minLength={5}
            maxLength={MAX_DESCRIPTION}
            rows={3}
            onChange={(event) => {
              setDescription(event.target.value);
              edited();
            }}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending || description.trim().length < 5}
          className="self-start rounded-md bg-red-700 px-5 py-3 font-semibold text-white disabled:opacity-40"
        >
          {pending ? "Enviando…" : "Enviar alerta de reforço"}
        </button>
      </form>

      <div aria-live="assertive">
        {outcome?.kind === "stored" ? (
          <div
            role="status"
            className="rounded-md border border-green-600 px-3 py-2 text-green-800 dark:text-green-300"
          >
            <p className="font-medium">
              Alerta registrado no servidor às{" "}
              {formatDateTime(new Date(outcome.alert.createdAt))}
              {outcome.created
                ? ""
                : " (este envio já tinha chegado; nada foi duplicado)"}
              .
            </p>
            <p className="text-sm">
              Situação:{" "}
              {ALERT_STATUS_LABELS[outcome.alert.status as AlertStatus]}.
              Registrado não quer dizer visto: acompanhe até a coordenação
              reconhecer.{" "}
              <Link href={`/alertas/${outcome.alert.id}`} className="underline">
                Acompanhar este alerta
              </Link>
            </p>
          </div>
        ) : null}

        {outcome?.kind === "not-sent" ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-red-600 px-3 py-2 text-red-800 dark:text-red-300"
          >
            <p className="font-semibold">{NOT_SENT_GUIDANCE}</p>
            <p className="text-sm">{NOT_SENT_DETAIL[outcome.reason]}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => void send(false)}
              className="self-start rounded border border-red-600 px-3 py-1 text-sm"
            >
              Tentar enviar de novo pelo sistema
            </button>
          </div>
        ) : null}

        {outcome?.kind === "refused" ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-amber-600 px-3 py-2 text-amber-800 dark:text-amber-300"
          >
            <p>{outcome.message} O alerta não foi enviado.</p>
            {outcome.code === "ACTIVE_ALERT_EXISTS" ? (
              <div className="flex flex-wrap gap-3 text-sm">
                {outcome.activeAlertId ? (
                  <Link
                    href={`/alertas/${outcome.activeAlertId}`}
                    className="underline"
                  >
                    Ver o alerta ativo
                  </Link>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void send(true)}
                  className="rounded border border-amber-600 px-3 py-1"
                >
                  É outra necessidade: enviar novo alerta
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
