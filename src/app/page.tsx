import Link from "next/link";
import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { listAlerts } from "@/features/alerts/queries";
import {
  ALERT_STATUS_LABELS,
  minutesWaiting,
  type AlertStatus,
} from "@/features/alerts/rules";
import { getMyPresence } from "@/features/attendance/queries";
import { STATE_LABELS } from "@/features/attendance/states";
import { UserMenu } from "@/features/auth/components/user-menu";
import { listMyChecklists } from "@/features/checklists/queries";
import { PROGRESS_LABELS } from "@/features/checklists/rules";
import { listOccurrences } from "@/features/occurrences/queries";
import { listVisiblePosts } from "@/features/posts/queries";
import { OverviewTable } from "@/features/reports/components/overview-table";
import { SummaryView } from "@/features/reports/components/summary-view";
import { getOverview, listTeams } from "@/features/reports/queries";
import { FilterForm } from "@/features/schedules/components/filter-form";
import { listEntries } from "@/features/schedules/queries";
import { SCHEDULE_STATUS_LABELS } from "@/features/schedules/rules";
import { parseScheduleFilters } from "@/features/schedules/schemas";
import { ROLE_LABELS, type Actor } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import {
  addDays,
  formatDateTime,
  formatIsoDate,
  operationalToday,
} from "@/lib/dates";

export default function HomePage(props: PageProps<"/">) {
  return (
    <Suspense fallback={<Loading />}>
      <Panel {...props} />
    </Suspense>
  );
}

async function Panel({ searchParams }: PageProps<"/">) {
  const actor = await requireActor();
  const today = operationalToday(new Date());
  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={`Olá, ${actor.name}`}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {ROLE_LABELS[actor.role]}
          {actor.isAdmin ? " · Administrador" : ""}
          {actor.captainPostIds.length > 0 ? " · Capitão de posto" : ""}
        </p>
        {actor.role === "LIFEGUARD" ? (
          <LifeguardPanel actor={actor} today={today} />
        ) : (
          <ManagerPanel
            actor={actor}
            today={today}
            query={await searchParams}
          />
        )}
      </PageShell>
    </>
  );
}

// --- Lifeguard: own schedule, journey, checklist and post records ----------

async function LifeguardPanel({
  actor,
  today,
}: {
  actor: Actor;
  today: string;
}) {
  const [entries, presence, checklists, records, alerts] = await Promise.all([
    listEntries(actor, { from: today, to: addDays(today, 6) }),
    getMyPresence(actor, today),
    listMyChecklists(actor),
    listOccurrences(actor, { from: addDays(today, -6), to: today }),
    actor.captainPostIds.length > 0
      ? listAlerts(actor, { activeOnly: true })
      : Promise.resolve([]),
  ]);
  const journey =
    presence?.journeys.find((entry) => entry.date === today) ?? null;
  const checklist = checklists?.find((entry) => entry.date === today) ?? null;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Minha escala (7 dias)</h2>
        {entries.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhum dia escalado e confirmado.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {entries.map((entry) => (
              <li key={entry.id}>
                {formatIsoDate(entry.date)}
                {entry.date === today ? " (hoje)" : ""} ·{" "}
                {entry.schedule.post.code} ·{" "}
                {SCHEDULE_STATUS_LABELS[entry.schedule.status]}
              </li>
            ))}
          </ul>
        )}
        <Link href="/escalas" className="text-sm underline">
          Ver escala
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Hoje</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-medium">Entrada</dt>
          <dd>
            {journey?.checkIn
              ? `${formatDateTime(new Date(journey.checkIn.time))} · ${STATE_LABELS[journey.checkIn.status]}`
              : "Não recebida pelo servidor"}
          </dd>
          <dt className="font-medium">Saída</dt>
          <dd>
            {journey?.checkOut
              ? `${formatDateTime(new Date(journey.checkOut.time))} · ${STATE_LABELS[journey.checkOut.status]}`
              : "Não registrada"}
          </dd>
          <dt className="font-medium">Checklist</dt>
          <dd>
            {checklist ? (
              <Link href={`/checklists/${checklist.id}`} className="underline">
                {PROGRESS_LABELS[checklist.progress]}
              </Link>
            ) : (
              "Sem jornada hoje"
            )}
          </dd>
        </dl>
        <p className="text-xs text-zinc-500">
          Registros feitos sem internet que ainda não foram enviados aparecem só
          na tela de{" "}
          <Link href="/presenca" className="underline">
            Presença
          </Link>{" "}
          deste aparelho.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          Registros dos meus postos (7 dias)
        </h2>
        <p className="text-sm">
          {records?.filter((record) => !record.annulment).length ?? 0}{" "}
          registro(s).{" "}
          <Link href="/ocorrencias" className="underline">
            Ver
          </Link>{" "}
          ·{" "}
          <Link href="/ocorrencias/nova" className="underline">
            Novo registro
          </Link>
        </p>
      </section>

      {actor.captainPostIds.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Alertas ativos do meu posto</h2>
          <AlertList alerts={alerts ?? []} />
          <Link
            href="/alertas/novo"
            className="text-sm font-medium text-red-700 underline"
          >
            Enviar alerta de reforço
          </Link>
        </section>
      ) : null}
    </div>
  );
}

// --- Coordinator and authority: indicators of the scope ------------------

async function ManagerPanel({
  actor,
  today,
  query,
}: {
  actor: Actor;
  today: string;
  query: Record<string, string | string[] | undefined>;
}) {
  // Default: today. Same filters (and limits) as the other screens.
  const { filters, errors } = parseScheduleFilters(
    { de: today, ate: today, ...query },
    today,
  );
  const [overview, teams, alerts, posts] = await Promise.all([
    getOverview(actor, filters, today),
    listTeams(actor),
    listAlerts(actor, { activeOnly: true }),
    listVisiblePosts(actor),
  ]);
  if (!overview) {
    return <p>Seu perfil não tem painel de indicadores.</p>;
  }
  const isCoordinator =
    actor.role === "COORDINATOR" && actor.coordinatedPostIds.length > 0;
  const { total } = overview;

  return (
    <div className="flex flex-col gap-6">
      {actor.role === "AUTHORITY" ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Consulta de todos os postos. Nenhuma ação operacional é feita a partir
          daqui.
        </p>
      ) : null}
      <FilterForm
        action="/"
        posts={posts}
        showDates
        values={{ de: filters.from, ate: filters.to, posto: filters.postId }}
      />
      {errors.length > 0 ? (
        <ul role="alert" className="text-sm text-amber-700">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm">
        Período: {formatIsoDate(filters.from)}
        {filters.to !== filters.from
          ? ` a ${formatIsoDate(filters.to)}`
          : ""} · {overview.posts.length} posto(s). Números ao vivo; fechamentos
        enviados guardam a versão da época.
      </p>

      <SummaryView summary={total} />

      {isCoordinator ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Pendências operacionais</h2>
          <ul className="flex flex-col gap-1 text-sm">
            <li>
              <Link href="/presenca/validacao" className="underline">
                {total.presence.pendingRecords} registro(s) de presença
                aguardando decisão
              </Link>
            </li>
            <li>
              <Link
                href={`/checklists?data=${filters.to}`}
                className="underline"
              >
                {total.checklists.incomplete + total.checklists.notStarted}{" "}
                checklist(s) não enviado(s)
              </Link>
            </li>
            <li>
              <Link
                href={`/checklists/problemas?de=${filters.from}&ate=${filters.to}`}
                className="underline"
              >
                {total.checklists.problems} problema(s) de materiais
              </Link>
            </li>
            <li>
              <Link href="/alertas" className="underline">
                {alerts?.length ?? 0} alerta(s) ativo(s) agora
              </Link>
            </li>
            <li>
              <Link
                href={`/fechamento?de=${filters.from}&ate=${filters.to}`}
                className="underline"
              >
                {overview.reportsToSend} fechamento(s) pendente(s) de envio ·{" "}
                {overview.reportsToConsolidate} de consolidação
              </Link>
            </li>
            <li>
              {total.staffing.absent} escalado(s) sem entrada ·{" "}
              {
                overview.rows.filter((row) =>
                  row.warnings.includes("NO_SCHEDULE"),
                ).length
              }{" "}
              posto-dia(s) sem escala confirmada
            </li>
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Alertas ativos</h2>
        <AlertList alerts={alerts ?? []} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Por posto e dia</h2>
        <OverviewTable rows={overview.rows} posts={overview.posts} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          {isCoordinator ? "Meus postos e equipes" : "Postos e equipes"}
        </h2>
        {!teams || teams.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nenhum posto.</p>
        ) : (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {teams.map((post) => {
              const captain = post.assignments.find(
                (member) => member.isCaptain,
              );
              return (
                <li
                  key={post.id}
                  className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <Link
                    href={`/postos/${post.id}`}
                    className="font-medium underline"
                  >
                    {post.code} · {post.name}
                  </Link>
                  <span className="block text-zinc-600 dark:text-zinc-400">
                    {post.assignments.length} na equipe · capitão:{" "}
                    {captain?.user.name ?? "não definido"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function AlertList({
  alerts,
}: {
  alerts: {
    id: string;
    status: string;
    createdAt: Date;
    post: { code: string };
  }[];
}) {
  if (alerts.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Nenhum alerta ativo.
      </p>
    );
  }
  const now = new Date();
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <Link href={`/alertas/${alert.id}`} className="underline">
            {alert.post.code} ·{" "}
            {ALERT_STATUS_LABELS[alert.status as AlertStatus]}
          </Link>
          {alert.status === "OPEN" ? (
            <span className="font-semibold text-red-700 dark:text-red-400">
              {" "}
              há {minutesWaiting(alert.createdAt, now)} min sem reconhecimento
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
