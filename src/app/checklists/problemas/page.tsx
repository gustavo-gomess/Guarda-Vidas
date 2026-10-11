import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { listMaterialProblems } from "@/features/checklists/queries";
import { ITEM_STATE_LABELS, PROBLEM_STATES } from "@/features/checklists/rules";
import { listVisiblePosts } from "@/features/posts/queries";
import { parseScheduleFilters } from "@/features/schedules/schemas";
import { requireActor } from "@/lib/auth/session";
import {
  formatDateTime,
  formatIsoDate,
  addDays,
  operationalToday,
} from "@/lib/dates";

export default function ProblemsPage(
  props: PageProps<"/checklists/problemas">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

const controlClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

async function Content({ searchParams }: PageProps<"/checklists/problemas">) {
  const actor = await requireActor();
  const query = await searchParams;
  const today = operationalToday(new Date());
  // Same date/post parsing as the schedules (de, ate, posto); default: last week.
  const { filters, errors } = parseScheduleFilters(
    { de: addDays(today, -6), ate: today, ...query },
    today,
  );
  const rawState = Array.isArray(query.estado) ? query.estado[0] : query.estado;
  const state = z
    .enum(["MISSING", "DAMAGED", "INADEQUATE"])
    .safeParse(rawState).data;

  const problems = await listMaterialProblems(actor, {
    from: filters.from,
    to: filters.to,
    postId: filters.postId,
    state,
  });
  if (!problems) notFound();
  const posts = await listVisiblePosts(actor);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Problemas de materiais">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Itens ausentes, danificados ou inadequados nas respostas atuais dos
          checklists enviados. O autor é quem registrou; o registro pertence ao
          histórico do posto.
        </p>
        <form
          action="/checklists/problemas"
          className="flex flex-wrap items-end gap-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium">De</span>
            <input
              type="date"
              name="de"
              defaultValue={filters.from}
              className={controlClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Até</span>
            <input
              type="date"
              name="ate"
              defaultValue={filters.to}
              className={controlClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Posto</span>
            <select
              name="posto"
              defaultValue={filters.postId ?? ""}
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
            <span className="font-medium">Problema</span>
            <select
              name="estado"
              defaultValue={state ?? ""}
              className={controlClass}
            >
              <option value="">Todos</option>
              {PROBLEM_STATES.map((value) => (
                <option key={value} value={value}>
                  {ITEM_STATE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
          >
            Filtrar
          </button>
        </form>
        {errors.length > 0 ? (
          <ul role="alert" className="text-sm text-amber-700">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        {problems.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhum problema registrado no período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-3">Dia</th>
                  <th className="py-2 pr-3">Posto</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Problema</th>
                  <th className="py-2 pr-3">Observação</th>
                  <th className="py-2 pr-3">Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((problem) => (
                  <tr
                    key={`${problem.journeyId}-${problem.itemId}`}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/checklists/${problem.journeyId}`}
                        className="underline"
                      >
                        {formatIsoDate(problem.date)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{problem.post.code}</td>
                    <td className="py-2 pr-3">{problem.label}</td>
                    <td className="py-2 pr-3">
                      {ITEM_STATE_LABELS[problem.state]}
                    </td>
                    <td className="py-2 pr-3">{problem.note || "—"}</td>
                    <td className="py-2 pr-3">
                      {problem.author} · {formatDateTime(problem.recordedAt)}
                      {problem.corrected ? " (corrigido)" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageShell>
    </>
  );
}
