import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { DecisionForm } from "@/features/attendance/components/decision-form";
import { RecordDetails } from "@/features/attendance/components/record-details";
import { listValidationQueue } from "@/features/attendance/queries";
import { KIND_LABELS, STATE_LABELS } from "@/features/attendance/states";
import { UserMenu } from "@/features/auth/components/user-menu";
import { listVisiblePosts } from "@/features/posts/queries";
import { FilterForm } from "@/features/schedules/components/filter-form";
import { requireActor } from "@/lib/auth/session";
import { formatIsoDate, isIsoDate } from "@/lib/dates";

export default function ValidationPage(
  props: PageProps<"/presenca/validacao">,
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

async function Content({ searchParams }: PageProps<"/presenca/validacao">) {
  const actor = await requireActor();
  const query = await searchParams;
  const postId = z.uuid().safeParse(first(query.posto)).data;
  const rawDate = first(query.data);
  const date = rawDate && isIsoDate(rawDate) ? rawDate : undefined;

  const records = await listValidationQueue(actor, { postId, date });
  if (!records) notFound();
  const posts = await listVisiblePosts(actor);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Presença: aguardando decisão">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Entradas sem internet e registros com divergência. Nada é descartado
          automaticamente: a hora do aparelho e a localização são indícios, não
          prova. Rejeitar exige justificativa.
        </p>
        <FilterForm
          action="/presenca/validacao"
          posts={posts}
          values={{ posto: postId }}
        />
        {rawDate && !date ? (
          <p role="alert" className="text-sm text-amber-700">
            Data inválida no filtro; mostrando todas as datas.
          </p>
        ) : null}
        {records.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhum registro aguardando decisão.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {records.map((record) => (
              <li
                key={record.id}
                className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p>
                  <strong>{record.user.name}</strong> ·{" "}
                  {KIND_LABELS[record.kind]}
                  {record.primaryKind ? "" : " (repetida)"} · {record.post.code}{" "}
                  · {formatIsoDate(record.date)} ·{" "}
                  <span className="font-medium">
                    {STATE_LABELS[record.status]}
                  </span>{" "}
                  ·{" "}
                  <Link
                    href={`/presenca/jornadas/${record.journeyId}`}
                    className="underline"
                  >
                    ver jornada e histórico
                  </Link>
                </p>
                <RecordDetails {...record} />
                {record.canDecide ? (
                  <DecisionForm recordId={record.id} status={record.status} />
                ) : (
                  <p className="text-sm text-zinc-500">Somente consulta.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </>
  );
}
