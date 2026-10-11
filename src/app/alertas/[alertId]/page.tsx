import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ActionForm } from "@/components/ui/action-form";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { transitionAlertAction } from "@/features/alerts/actions";
import { AutoRefresh } from "@/features/alerts/components/live";
import { getAlertForActor } from "@/features/alerts/queries";
import {
  ALERT_ACTION_LABELS,
  ALERT_STATUS_LABELS,
  availableActions,
  minutesWaiting,
  requiresNote,
  type AlertAction,
  type AlertStatus,
} from "@/features/alerts/rules";
import { UserMenu } from "@/features/auth/components/user-menu";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";

export default function AlertPage(props: PageProps<"/alertas/[alertId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

const CONFIRM_TEXT: Record<AlertAction, string> = {
  ACKNOWLEDGE: "Confirmo que li o alerta e a coordenação está ciente",
  START: "Confirmo que o reforço está sendo providenciado",
  CLOSE: "Confirmo o encerramento",
  CANCEL: "Confirmo o cancelamento",
};

async function Content({ params }: PageProps<"/alertas/[alertId]">) {
  const actor = await requireActor();
  const id = z.uuid().safeParse((await params).alertId);
  if (!id.success) notFound();
  const alert = await getAlertForActor(actor, id.data);
  if (!alert) notFound();
  const status = alert.status as AlertStatus;
  const actions = availableActions(status).filter(
    (action) => alert.canManage || (action === "CANCEL" && alert.isAuthor),
  );

  return (
    <>
      <UserMenu actor={actor} />
      <AutoRefresh />
      <PageShell title={`Alerta · ${alert.post.code} · ${alert.post.name}`}>
        <section
          className={`flex flex-col gap-1 rounded-md border p-3 ${status === "OPEN" ? "border-red-600" : "border-zinc-200 dark:border-zinc-800"}`}
        >
          <p className="text-lg font-semibold">
            {ALERT_STATUS_LABELS[status]}
            {status === "OPEN"
              ? ` há ${minutesWaiting(alert.createdAt, new Date())} min`
              : ""}
          </p>
          <p>{alert.description}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Enviado por {alert.author.name} · registrado no servidor em{" "}
            {formatDateTime(alert.createdAt)} (hora do aparelho:{" "}
            {formatDateTime(alert.deviceTime)})
          </p>
        </section>

        {actions.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Ações</h2>
            {actions.map((action) => (
              <ActionForm
                key={action}
                action={transitionAlertAction}
                submitLabel={ALERT_ACTION_LABELS[action]}
                successMessage="Registrado."
                className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <input type="hidden" name="alertId" value={alert.id} />
                <input type="hidden" name="action" value={action} />
                <input type="hidden" name="expectedStatus" value={status} />
                {requiresNote(action) ? (
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">
                      {action === "CLOSE"
                        ? "Resultado do atendimento"
                        : "Motivo do cancelamento"}{" "}
                      (obrigatório)
                    </span>
                    <input
                      name="note"
                      required
                      minLength={5}
                      maxLength={500}
                      className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1">
                    <span>Observação (opcional)</span>
                    <input
                      name="note"
                      maxLength={500}
                      className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="confirmed"
                    required
                    className="size-5"
                  />
                  {CONFIRM_TEXT[action]}
                </label>
              </ActionForm>
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Histórico</h2>
          <ol className="flex flex-col gap-2 text-sm">
            {alert.events.map((event) => (
              <li
                key={event.id}
                className="border-l-2 border-zinc-300 pl-3 dark:border-zinc-700"
              >
                <span className="font-medium">
                  {event.fromStatus
                    ? `${ALERT_STATUS_LABELS[event.fromStatus as AlertStatus]} → `
                    : "Enviado · "}
                  {ALERT_STATUS_LABELS[event.toStatus as AlertStatus]}
                </span>{" "}
                · {formatDateTime(event.createdAt)} · {event.actor.name}
                {event.note ? (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {event.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
        <Link href="/alertas" className="text-sm underline">
          Voltar aos alertas
        </Link>
      </PageShell>
    </>
  );
}
