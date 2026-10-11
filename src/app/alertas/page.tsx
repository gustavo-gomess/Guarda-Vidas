import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { AutoRefresh } from "@/features/alerts/components/live";
import { listAlerts } from "@/features/alerts/queries";
import {
  ALERT_STATUS_LABELS,
  minutesWaiting,
  type AlertStatus,
} from "@/features/alerts/rules";
import { UserMenu } from "@/features/auth/components/user-menu";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";

export default function AlertsPage(props: PageProps<"/alertas">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

const STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "CLOSED",
  "CANCELLED",
] as const;

async function Content({ searchParams }: PageProps<"/alertas">) {
  const actor = await requireActor();
  const query = await searchParams;
  const raw = Array.isArray(query.situacao)
    ? query.situacao[0]
    : query.situacao;
  const showAll = raw === "todos";
  const status = z.enum(STATUSES).safeParse(raw).data;

  const alerts = await listAlerts(actor, { status, activeOnly: !showAll });
  if (!alerts) notFound();
  const now = new Date();

  return (
    <>
      <UserMenu actor={actor} />
      <AutoRefresh />
      <PageShell title="Alertas de reforço">
        <nav
          className="flex flex-wrap gap-3 text-sm"
          aria-label="Filtro de situação"
        >
          <Link
            href="/alertas"
            className={!raw ? "font-semibold" : "underline"}
          >
            Ativos
          </Link>
          {STATUSES.map((value) => (
            <Link
              key={value}
              href={`/alertas?situacao=${value}`}
              className={status === value ? "font-semibold" : "underline"}
            >
              {ALERT_STATUS_LABELS[value]}
            </Link>
          ))}
          <Link
            href="/alertas?situacao=todos"
            className={showAll && !status ? "font-semibold" : "underline"}
          >
            Todos
          </Link>
          {actor.captainPostIds.length > 0 ? (
            <Link
              href="/alertas/novo"
              className="font-semibold text-red-700 underline"
            >
              Enviar alerta de reforço
            </Link>
          ) : null}
        </nav>
        <p className="text-xs text-zinc-500">
          Atualiza a cada 30 segundos enquanto a página está aberta.
        </p>

        {alerts.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhum alerta{" "}
            {status
              ? ALERT_STATUS_LABELS[status].toLowerCase()
              : showAll
                ? ""
                : "ativo"}
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {alerts.map((alert) => {
              const open = alert.status === "OPEN";
              const last = alert.events[0];
              return (
                <li
                  key={alert.id}
                  className={`rounded-md border p-3 ${open ? "border-red-600 bg-red-50 dark:bg-red-950" : "border-zinc-200 dark:border-zinc-800"}`}
                >
                  <p className="flex flex-wrap gap-x-2">
                    <Link
                      href={`/alertas/${alert.id}`}
                      className="font-semibold underline"
                    >
                      {alert.post.code} · {alert.post.name}
                    </Link>
                    <span
                      className={
                        open
                          ? "font-semibold text-red-700 dark:text-red-400"
                          : ""
                      }
                    >
                      {ALERT_STATUS_LABELS[alert.status as AlertStatus]}
                      {open
                        ? ` há ${minutesWaiting(alert.createdAt, now)} min`
                        : ""}
                    </span>
                  </p>
                  <p className="text-sm">{alert.description}</p>
                  <p className="text-xs text-zinc-500">
                    Enviado por {alert.author.name} em{" "}
                    {formatDateTime(alert.createdAt)}
                    {last && last.toStatus !== "OPEN"
                      ? ` · última ação: ${ALERT_STATUS_LABELS[last.toStatus as AlertStatus].toLowerCase()} por ${last.actor.name} em ${formatDateTime(last.createdAt)}`
                      : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </PageShell>
    </>
  );
}
