import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { getPresenceBoard } from "@/features/attendance/queries";
import { STATE_LABELS, type ServerStatus } from "@/features/attendance/states";
import { UserMenu } from "@/features/auth/components/user-menu";
import { listVisiblePosts } from "@/features/posts/queries";
import { FilterForm } from "@/features/schedules/components/filter-form";
import { requireActor } from "@/lib/auth/session";
import {
  formatDateTime,
  formatIsoDate,
  isIsoDate,
  operationalToday,
} from "@/lib/dates";

export default function PresenceBoardPage(
  props: PageProps<"/presenca/painel">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const statusClass: Record<ServerStatus, string> = {
  VALIDATED: "text-green-700 dark:text-green-400",
  AWAITING_VALIDATION: "text-amber-700 dark:text-amber-400",
  UNDER_REVIEW: "text-amber-700 dark:text-amber-400",
  REJECTED: "text-red-700 dark:text-red-400",
};

/** Validated presence is official; everything else is provisional. */
function presenceLabel(status: ServerStatus | undefined) {
  if (!status) return "Sem registro";
  if (status === "VALIDATED") return "Presença validada";
  if (status === "REJECTED") return "Entrada rejeitada";
  return `Provisória: ${STATE_LABELS[status].toLowerCase()}`;
}

async function Content({ searchParams }: PageProps<"/presenca/painel">) {
  const actor = await requireActor();
  const query = await searchParams;
  const today = operationalToday(new Date());
  const rawDate = first(query.data);
  const date = rawDate && isIsoDate(rawDate) ? rawDate : today;
  const postId = z.uuid().safeParse(first(query.posto)).data;

  const rows = await getPresenceBoard(actor, { date, postId });
  if (!rows) notFound();
  const posts = await listVisiblePosts(actor);

  const count = (predicate: (status: ServerStatus | undefined) => boolean) =>
    rows.filter((row) => predicate(row.journey?.checkIn?.status)).length;

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={`Presença · ${formatIsoDate(date)}`}>
        <form
          action="/presenca/painel"
          className="flex flex-wrap items-end gap-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium">Dia</span>
            <input
              type="date"
              name="data"
              defaultValue={date}
              className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          {postId ? <input type="hidden" name="posto" value={postId} /> : null}
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
          >
            Ver dia
          </button>
        </form>
        <FilterForm
          action="/presenca/painel"
          posts={posts}
          values={{ posto: postId }}
        />
        {rawDate && rawDate !== date ? (
          <p role="alert" className="text-sm text-amber-700">
            Data inválida no filtro; mostrando hoje.
          </p>
        ) : null}

        <p className="text-sm">
          <span className={statusClass.VALIDATED}>
            {count((status) => status === "VALIDATED")} validadas
          </span>{" "}
          ·{" "}
          <span className={statusClass.AWAITING_VALIDATION}>
            {count(
              (status) =>
                status === "AWAITING_VALIDATION" || status === "UNDER_REVIEW",
            )}{" "}
            provisórias
          </span>{" "}
          ·{" "}
          <span className={statusClass.REJECTED}>
            {count((status) => status === "REJECTED")} rejeitadas
          </span>{" "}
          · {count((status) => status === undefined)} sem registro ·{" "}
          <Link href="/presenca/validacao" className="underline">
            fila de validação
          </Link>
        </p>
        <p className="text-xs text-zinc-500">
          Entradas feitas sem internet só aparecem aqui depois de sincronizadas
          pelo aparelho.
        </p>

        {rows.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Ninguém escalado nem registrado neste dia.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-3">Guarda-vidas</th>
                  <th className="py-2 pr-3">Escala</th>
                  <th className="py-2 pr-3">Presença</th>
                  <th className="py-2 pr-3">Entrada</th>
                  <th className="py-2 pr-3">Saída</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const entry = row.journey?.checkIn;
                  const exit = row.journey?.checkOut;
                  return (
                    <tr
                      key={row.user.id}
                      className="border-b border-zinc-100 dark:border-zinc-900"
                    >
                      <td className="py-2 pr-3">{row.user.name}</td>
                      <td className="py-2 pr-3">
                        {row.scheduledPost?.code ?? "Sem escala"}
                      </td>
                      <td
                        className={`py-2 pr-3 ${entry ? statusClass[entry.status] : ""}`}
                      >
                        {row.journey ? (
                          <Link
                            href={`/presenca/jornadas/${row.journey.id}`}
                            className="underline"
                          >
                            {presenceLabel(entry?.status)}
                          </Link>
                        ) : (
                          presenceLabel(undefined)
                        )}
                        {row.journey && row.journey.extraRecords > 0
                          ? ` · +${row.journey.extraRecords} registro(s) repetido(s)`
                          : ""}
                      </td>
                      <td className="py-2 pr-3">
                        {entry
                          ? `${formatDateTime(new Date(entry.time))}${entry.origin === "OFFLINE" ? " (aparelho)" : ""}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {exit
                          ? `${formatDateTime(new Date(exit.time))} · ${STATE_LABELS[exit.status]}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageShell>
    </>
  );
}
