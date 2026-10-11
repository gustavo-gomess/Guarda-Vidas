import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { formatValue } from "@/features/occurrences/fields";
import {
  listCategories,
  listOccurrences,
} from "@/features/occurrences/queries";
import { listVisiblePosts } from "@/features/posts/queries";
import { parseScheduleFilters } from "@/features/schedules/schemas";
import { requireActor } from "@/lib/auth/session";
import { addDays, formatDateTime, operationalToday } from "@/lib/dates";

export default function OccurrencesPage(props: PageProps<"/ocorrencias">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

const controlClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

async function Content({ searchParams }: PageProps<"/ocorrencias">) {
  const actor = await requireActor();
  const query = await searchParams;
  const today = operationalToday(new Date());
  const { filters, errors } = parseScheduleFilters(
    { de: addDays(today, -6), ate: today, ...query },
    today,
  );
  const rawCategory = Array.isArray(query.categoria)
    ? query.categoria[0]
    : query.categoria;
  const categoryId = z.uuid().safeParse(rawCategory).data;

  const [records, posts, categories] = await Promise.all([
    listOccurrences(actor, {
      from: filters.from,
      to: filters.to,
      postId: filters.postId,
      categoryId,
    }),
    listVisiblePosts(actor),
    listCategories(true),
  ]);
  if (!records) notFound();

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Registros operacionais">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ocorrências, ações preventivas e outros registros. Eles pertencem ao
          histórico do posto: o autor é identificado e nada é apagado.
          {actor.role === "LIFEGUARD" ? (
            <>
              {" "}
              <Link href="/ocorrencias/nova" className="font-medium underline">
                Novo registro
              </Link>
            </>
          ) : null}
        </p>
        <form
          action="/ocorrencias"
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
            <span className="font-medium">Categoria</span>
            <select
              name="categoria"
              defaultValue={categoryId ?? ""}
              className={controlClass}
            >
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.current.name}
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

        {records.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhum registro no período.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {records.map((record) => (
              <li
                key={record.id}
                className={`rounded-md border p-3 text-sm ${record.annulment ? "border-zinc-200 opacity-60 dark:border-zinc-800" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                <p>
                  <Link
                    href={`/ocorrencias/${record.id}`}
                    className="font-medium underline"
                  >
                    {record.categoryVersion.name}
                  </Link>{" "}
                  · {record.post.code} · {formatDateTime(record.occurredAt)} ·
                  por {record.author.name}
                  {record.annulment ? " · ANULADO" : ""}
                </p>
                {record.categoryVersion.fields.length > 0 ? (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {record.categoryVersion.fields
                      .map(
                        (field) =>
                          `${field.label}: ${formatValue(field, record.values[field.key] ?? null)}`,
                      )
                      .join(" · ")}
                  </p>
                ) : null}
                {record.description ? <p>{record.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </>
  );
}
