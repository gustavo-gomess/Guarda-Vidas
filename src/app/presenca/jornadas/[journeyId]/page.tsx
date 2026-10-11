import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { AuditList } from "@/components/ui/audit-list";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { DecisionForm } from "@/features/attendance/components/decision-form";
import { RecordDetails } from "@/features/attendance/components/record-details";
import { getJourneyForActor } from "@/features/attendance/queries";
import { KIND_LABELS, STATE_LABELS } from "@/features/attendance/states";
import { UserMenu } from "@/features/auth/components/user-menu";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatIsoDate } from "@/lib/dates";

export default function JourneyPage(
  props: PageProps<"/presenca/jornadas/[journeyId]">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({
  params,
}: PageProps<"/presenca/jornadas/[journeyId]">) {
  const actor = await requireActor();
  const id = z.uuid().safeParse((await params).journeyId);
  if (!id.success) notFound();
  const journey = await getJourneyForActor(actor, id.data);
  // Unknown, another person's, or outside the area: the same "not found".
  if (!journey) notFound();

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell
        title={`Jornada · ${journey.user.name} · ${formatIsoDate(journey.date)}`}
      >
        <p className="text-sm">
          Posto {journey.post.code} · {journey.post.name} · aberta pelo servidor
          em {formatDateTime(journey.createdAt)}
        </p>

        {journey.records.map((record) => (
          <section
            key={record.id}
            className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <h2 className="font-semibold">
              {KIND_LABELS[record.kind]}
              {record.primaryKind
                ? ""
                : " repetida (não conta na jornada)"} ·{" "}
              {formatDateTime(record.effectiveTime)} ·{" "}
              {STATE_LABELS[record.status]}
            </h2>
            <RecordDetails {...record} />
            <h3 className="text-sm font-medium">Decisões</h3>
            <ol className="flex flex-col gap-1 text-sm">
              {record.decisions.map((decision) => (
                <li key={decision.id}>
                  {formatDateTime(decision.createdAt)} ·{" "}
                  {decision.decidedBy?.name ?? "Sistema (ao receber)"} ·{" "}
                  {decision.fromStatus
                    ? `${STATE_LABELS[decision.fromStatus]} → `
                    : ""}
                  {STATE_LABELS[decision.toStatus]}
                  {decision.reason ? ` · ${decision.reason}` : ""}
                </li>
              ))}
            </ol>
            {journey.canDecide ? (
              <DecisionForm recordId={record.id} status={record.status} />
            ) : null}
          </section>
        ))}

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Histórico de alterações</h2>
          <AuditList entries={journey.audit} />
        </section>
      </PageShell>
    </>
  );
}
