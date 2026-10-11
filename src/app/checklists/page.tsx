import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  listChecklistOverview,
  listMyChecklists,
} from "@/features/checklists/queries";
import {
  PROGRESS_LABELS,
  type ChecklistProgress,
} from "@/features/checklists/rules";
import { listVisiblePosts } from "@/features/posts/queries";
import { requireActor } from "@/lib/auth/session";
import {
  formatDateTime,
  formatIsoDate,
  isIsoDate,
  operationalToday,
} from "@/lib/dates";

export default function ChecklistsPage(props: PageProps<"/checklists">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const progressClass: Record<ChecklistProgress, string> = {
  PENDING: "text-red-700 dark:text-red-400",
  INCOMPLETE: "text-amber-700 dark:text-amber-400",
  SUBMITTED: "text-green-700 dark:text-green-400",
};

const controlClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

async function Content({ searchParams }: PageProps<"/checklists">) {
  const actor = await requireActor();
  const mine = await listMyChecklists(actor);

  if (mine) {
    return (
      <>
        <UserMenu actor={actor} />
        <PageShell title="Meus checklists">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Cada entrada registrada (assunção) tem o seu próprio checklist. O
            checklist exige internet para salvar e enviar.
          </p>
          {mine.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Nenhuma jornada ainda.{" "}
              <Link href="/presenca" className="underline">
                Registre a entrada
              </Link>{" "}
              para preencher o checklist.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {mine.map((row) => (
                <li key={row.id}>
                  <Link href={`/checklists/${row.id}`} className="underline">
                    {formatIsoDate(row.date)} · {row.post.code} ·{" "}
                    {row.post.name}
                  </Link>{" "}
                  ·{" "}
                  <span className={progressClass[row.progress]}>
                    {PROGRESS_LABELS[row.progress]}
                  </span>
                  {row.problems > 0 ? ` · ${row.problems} problema(s)` : ""}
                </li>
              ))}
            </ul>
          )}
        </PageShell>
      </>
    );
  }

  const query = await searchParams;
  const today = operationalToday(new Date());
  const rawDate = first(query.data);
  const date = rawDate && isIsoDate(rawDate) ? rawDate : today;
  const postId = z.uuid().safeParse(first(query.posto)).data;
  const progress = z
    .enum(["PENDING", "INCOMPLETE", "SUBMITTED"])
    .safeParse(first(query.situacao)).data;

  const [rows, posts] = await Promise.all([
    listChecklistOverview(actor, { date, postId, progress }),
    listVisiblePosts(actor),
  ]);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={`Checklists · ${formatIsoDate(date)}`}>
        {rows === null ? (
          <p>Seu perfil não consulta checklists.</p>
        ) : (
          <>
            <form
              action="/checklists"
              className="flex flex-wrap items-end gap-3 text-sm"
            >
              <label className="flex flex-col gap-1">
                <span className="font-medium">Dia</span>
                <input
                  type="date"
                  name="data"
                  defaultValue={date}
                  className={controlClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Posto</span>
                <select
                  name="posto"
                  defaultValue={postId ?? ""}
                  className={controlClass}
                >
                  <option value="">Todos</option>
                  {posts.map((post) => (
                    <option key={post.id} value={post.id}>
                      {post.code} · {post.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Situação</span>
                <select
                  name="situacao"
                  defaultValue={progress ?? ""}
                  className={controlClass}
                >
                  <option value="">Todas</option>
                  {(Object.keys(PROGRESS_LABELS) as ChecklistProgress[]).map(
                    (value) => (
                      <option key={value} value={value}>
                        {PROGRESS_LABELS[value]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                type="submit"
                className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
              >
                Filtrar
              </button>
            </form>
            {rawDate && rawDate !== date ? (
              <p role="alert" className="text-sm text-amber-700">
                Data inválida no filtro; mostrando hoje.
              </p>
            ) : null}
            <p className="text-sm">
              <Link href="/checklists/problemas" className="underline">
                Problemas de materiais
              </Link>
            </p>
            {rows.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">
                Nenhuma assunção neste dia com estes filtros.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      <th className="py-2 pr-3">Posto</th>
                      <th className="py-2 pr-3">Guarda-vidas</th>
                      <th className="py-2 pr-3">Checklist</th>
                      <th className="py-2 pr-3">Problemas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-zinc-100 dark:border-zinc-900"
                      >
                        <td className="py-2 pr-3">{row.post.code}</td>
                        <td className="py-2 pr-3">{row.user.name}</td>
                        <td
                          className={`py-2 pr-3 ${progressClass[row.progress]}`}
                        >
                          <Link
                            href={`/checklists/${row.id}`}
                            className="underline"
                          >
                            {PROGRESS_LABELS[row.progress]}
                          </Link>
                          {row.submittedAt
                            ? ` · ${formatDateTime(row.submittedAt)}`
                            : ""}
                        </td>
                        <td className="py-2 pr-3">{row.problems || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </PageShell>
    </>
  );
}
