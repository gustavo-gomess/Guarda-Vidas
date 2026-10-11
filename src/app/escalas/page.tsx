import Link from "next/link";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { SelectField } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { listLifeguardsInScope } from "@/features/availability/queries";
import { listVisiblePosts } from "@/features/posts/queries";
import { createScheduleAction } from "@/features/schedules/actions";
import { FilterForm } from "@/features/schedules/components/filter-form";
import {
  getScheduleCreationOptions,
  listEntries,
  listSchedules,
} from "@/features/schedules/queries";
import {
  SCHEDULE_STATUS_LABELS,
  WINDOW_STATUS_LABELS,
  windowEnd,
} from "@/features/schedules/rules";
import { parseScheduleFilters } from "@/features/schedules/schemas";
import { requireActor } from "@/lib/auth/session";
import { formatIsoDate, operationalToday } from "@/lib/dates";

export default function SchedulesPage(props: PageProps<"/escalas">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<"/escalas">) {
  const actor = await requireActor();
  const today = operationalToday(new Date());
  const { filters, errors } = parseScheduleFilters(await searchParams, today);
  const isLifeguard = actor.role === "LIFEGUARD";

  const [entries, schedules, posts, people, creation] = await Promise.all([
    listEntries(actor, filters),
    listSchedules(actor, filters),
    listVisiblePosts(actor),
    isLifeguard ? Promise.resolve(undefined) : listLifeguardsInScope(actor),
    getScheduleCreationOptions(actor, today),
  ]);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={isLifeguard ? "Minha escala" : "Escalas"}>
        {isLifeguard ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Aparecem aqui só as escalas confirmadas pela coordenação. Enviar
            disponibilidade não garante escala.
          </p>
        ) : null}

        <FilterForm
          action="/escalas"
          posts={posts}
          people={people}
          showDates
          values={{
            de: filters.from,
            ate: filters.to,
            posto: filters.postId,
            profissional: filters.userId,
          }}
        />
        {errors.length > 0 ? (
          <ul
            role="alert"
            className="text-sm text-amber-700 dark:text-amber-400"
          >
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        {creation ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Montar escala</h2>
            {creation.posts.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">
                Nenhum posto em operação na sua área.
              </p>
            ) : creation.windows.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">
                Nenhuma janela vigente.{" "}
                <Link href="/disponibilidade" className="underline">
                  Abra uma janela de disponibilidade
                </Link>{" "}
                primeiro.
              </p>
            ) : (
              <ActionForm
                action={createScheduleAction}
                submitLabel="Abrir escala"
                className="flex flex-wrap items-end gap-3"
              >
                <SelectField
                  label="Posto"
                  name="postId"
                  options={creation.posts.map((post) => ({
                    value: post.id,
                    label: `${post.code} · ${post.name}`,
                  }))}
                />
                <SelectField
                  label="Período (janela)"
                  name="windowId"
                  options={creation.windows.map((window) => ({
                    value: window.id,
                    label: `${formatIsoDate(window.startDate)} a ${formatIsoDate(windowEnd(window.startDate))} (${WINDOW_STATUS_LABELS[window.status].toLowerCase()})`,
                  }))}
                />
              </ActionForm>
            )}
          </section>
        ) : null}

        {!isLifeguard ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Escalas no período</h2>
            {schedules.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">
                Nenhuma escala no período e filtros escolhidos.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {schedules.map((schedule) => (
                  <li key={schedule.id}>
                    <Link
                      href={`/escalas/${schedule.id}`}
                      className="underline"
                    >
                      {schedule.post.code} · {schedule.post.name} ·{" "}
                      {formatIsoDate(schedule.startDate)} a{" "}
                      {formatIsoDate(windowEnd(schedule.startDate))}
                    </Link>{" "}
                    · {SCHEDULE_STATUS_LABELS[schedule.status]} ·{" "}
                    {schedule.entryCount} escalações
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            {isLifeguard ? "Meus dias escalados" : "Escalações"}
          </h2>
          {entries.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              {isLifeguard
                ? "Você não tem escala confirmada neste período."
                : "Nenhuma escalação no período e filtros escolhidos."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3">Dia</th>
                    <th className="py-2 pr-3">Posto</th>
                    {isLifeguard ? null : (
                      <th className="py-2 pr-3">Guarda-vidas</th>
                    )}
                    <th className="py-2 pr-3">Escala</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-zinc-100 dark:border-zinc-900"
                    >
                      <td className="py-2 pr-3">
                        {formatIsoDate(entry.date)}
                        {entry.date === today ? " (hoje)" : ""}
                      </td>
                      <td className="py-2 pr-3">
                        {entry.schedule.post.code} · {entry.schedule.post.name}
                      </td>
                      {isLifeguard ? null : (
                        <td className="py-2 pr-3">
                          {entry.user.name}
                          {entry.user.active ? "" : " (inativo)"}
                        </td>
                      )}
                      <td className="py-2 pr-3">
                        {isLifeguard ? (
                          SCHEDULE_STATUS_LABELS[entry.schedule.status]
                        ) : (
                          <Link
                            href={`/escalas/${entry.schedule.id}`}
                            className="underline"
                          >
                            {SCHEDULE_STATUS_LABELS[entry.schedule.status]}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PageShell>
    </>
  );
}
