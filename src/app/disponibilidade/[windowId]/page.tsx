import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  getAvailabilityBoard,
  listLifeguardsInScope,
} from "@/features/availability/queries";
import { windowIdSchema } from "@/features/availability/schemas";
import { listVisiblePosts } from "@/features/posts/queries";
import { FilterForm } from "@/features/schedules/components/filter-form";
import {
  WINDOW_STATUS_LABELS,
  windowDays,
  windowEnd,
} from "@/features/schedules/rules";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatIsoDate } from "@/lib/dates";

export default function AvailabilityBoardPage(
  props: PageProps<"/disponibilidade/[windowId]">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

function optionalUuid(raw: string | string[] | undefined) {
  const parsed = z.uuid().safeParse(Array.isArray(raw) ? raw[0] : raw);
  return parsed.success ? parsed.data : undefined;
}

async function Content({
  params,
  searchParams,
}: PageProps<"/disponibilidade/[windowId]">) {
  const actor = await requireActor();
  const parsedId = windowIdSchema.safeParse((await params).windowId);
  if (!parsedId.success) notFound();
  const query = await searchParams;
  const filters = {
    postId: optionalUuid(query.posto),
    userId: optionalUuid(query.profissional),
  };

  const board = await getAvailabilityBoard(actor, parsedId.data, filters);
  // Lifeguards and unknown windows: the same "not found".
  if (!board) notFound();
  const [posts, people] = await Promise.all([
    listVisiblePosts(actor),
    listLifeguardsInScope(actor),
  ]);

  const { window, rows } = board;
  const days = windowDays(window.startDate);
  const sent = rows.filter((row) => row.answer);
  const totals = days.map(
    (_date, index) =>
      sent.filter(
        (row) => row.answer?.[`day${index + 1}` as "day1" | "day2" | "day3"],
      ).length,
  );

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell
        title={`Disponibilidade · ${formatIsoDate(window.startDate)} a ${formatIsoDate(windowEnd(window.startDate))}`}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {WINDOW_STATUS_LABELS[window.status]} · aberta por{" "}
          {window.createdBy.name}. Disponibilidade declarada não é escala:{" "}
          <Link href="/escalas" className="underline">
            monte a escala
          </Link>{" "}
          de cada posto.
        </p>

        <FilterForm
          action={`/disponibilidade/${window.id}`}
          posts={posts}
          people={people}
          values={{ posto: filters.postId, profissional: filters.userId }}
        />

        <p className="text-sm">
          {sent.length} de {rows.length} enviaram ·{" "}
          {days
            .map(
              (date, index) =>
                `${formatIsoDate(date)}: ${totals[index]} disponíveis`,
            )
            .join(" · ")}
        </p>

        {rows.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhum guarda-vidas encontrado com estes filtros.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-3">Guarda-vidas</th>
                  <th className="py-2 pr-3">Postos</th>
                  {days.map((date) => (
                    <th key={date} className="py-2 pr-3">
                      {formatIsoDate(date)}
                    </th>
                  ))}
                  <th className="py-2 pr-3">Observação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3">
                      {row.posts.map((post) => post.code).join(", ") || "—"}
                    </td>
                    {days.map((date, index) => {
                      const answer =
                        row.answer?.[
                          `day${index + 1}` as "day1" | "day2" | "day3"
                        ];
                      return (
                        <td key={date} className="py-2 pr-3">
                          {!row.answer
                            ? "Não enviou"
                            : answer
                              ? "Disponível"
                              : "Indisponível"}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-3">
                      {row.answer
                        ? `${row.answer.note || "—"} (${formatDateTime(row.answer.updatedAt)})`
                        : ""}
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
