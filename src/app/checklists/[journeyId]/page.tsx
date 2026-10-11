import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ActionForm } from "@/components/ui/action-form";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { startChecklistAction } from "@/features/checklists/actions";
import { ChecklistForm } from "@/features/checklists/components/checklist-form";
import { getChecklistForActor } from "@/features/checklists/queries";
import {
  ITEM_STATE_LABELS,
  PROGRESS_LABELS,
  REVISION_LABELS,
  type ItemState,
} from "@/features/checklists/rules";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatIsoDate } from "@/lib/dates";

export default function ChecklistPage(
  props: PageProps<"/checklists/[journeyId]">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

function stateLabel(state: ItemState | null) {
  return state ? ITEM_STATE_LABELS[state] : "sem resposta";
}

async function Content({ params }: PageProps<"/checklists/[journeyId]">) {
  const actor = await requireActor();
  const id = z.uuid().safeParse((await params).journeyId);
  if (!id.success) notFound();
  const data = await getChecklistForActor(actor, id.data);
  // Unknown, another lifeguard's, or outside the area: the same "not found".
  if (!data) notFound();
  const { checklist } = data;
  const lineLabel = (lineId: string) =>
    checklist?.lines.find((line) => line.id === lineId)?.label ?? "Item";

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell
        title={`Checklist · ${data.post.code} · ${formatIsoDate(data.date)}`}
      >
        <p className="text-sm">
          {data.user.name} · {data.post.name} ·{" "}
          <strong>{PROGRESS_LABELS[data.progress]}</strong>
          {checklist?.submittedAt
            ? ` em ${formatDateTime(checklist.submittedAt)}`
            : ""}
        </p>

        {!checklist ? (
          data.canFill ? (
            data.hasItems ? (
              <ActionForm
                action={startChecklistAction}
                submitLabel="Iniciar checklist desta assunção"
              >
                <input type="hidden" name="journeyId" value={data.id} />
              </ActionForm>
            ) : (
              <p className="text-amber-700 dark:text-amber-400">
                Este posto ainda não tem lista de itens. Avise a coordenação.
              </p>
            )
          ) : (
            <p className="text-zinc-600 dark:text-zinc-400">
              Checklist ainda não iniciado.
            </p>
          )
        ) : data.canFill ? (
          <ChecklistForm
            checklistId={checklist.id}
            submitted={checklist.status === "SUBMITTED"}
            lines={checklist.lines}
            current={checklist.current}
          />
        ) : (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Respostas atuais</h2>
            {checklist.current ? (
              <ul className="flex flex-col gap-1 text-sm">
                {checklist.lines.map((line) => {
                  const answer = checklist.current?.answers.find(
                    (a) => a.lineId === line.id,
                  );
                  return (
                    <li key={line.id}>
                      {line.label}:{" "}
                      <strong>{stateLabel(answer?.state ?? null)}</strong>
                      {answer?.note ? ` · ${answer.note}` : ""}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-zinc-600 dark:text-zinc-400">
                Nenhuma resposta salva.
              </p>
            )}
            {checklist.current?.generalNote ? (
              <p className="text-sm">
                Observações gerais: {checklist.current.generalNote}
              </p>
            ) : null}
          </section>
        )}

        {checklist && checklist.history.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Histórico de respostas</h2>
            <p className="text-xs text-zinc-500">
              A lista de itens foi copiada quando o checklist começou; mudanças
              posteriores na lista do posto não alteram este registro.
            </p>
            <ol className="flex flex-col gap-2 text-sm">
              {checklist.history.map((revision) => (
                <li
                  key={revision.id}
                  className="border-l-2 border-zinc-300 pl-3 dark:border-zinc-700"
                >
                  <p>
                    <span className="font-medium">
                      {REVISION_LABELS[revision.kind]} · versão{" "}
                      {revision.number}
                    </span>{" "}
                    · {formatDateTime(revision.createdAt)} ·{" "}
                    {revision.author.name}
                  </p>
                  {revision.reason ? <p>Motivo: {revision.reason}</p> : null}
                  {revision.changes.length > 0 ? (
                    <ul className="text-zinc-600 dark:text-zinc-400">
                      {revision.changes.map((change) => (
                        <li key={change.lineId}>
                          {lineLabel(change.lineId)}:{" "}
                          {stateLabel(change.before.state)}
                          {change.before.note
                            ? ` (${change.before.note})`
                            : ""}{" "}
                          → {stateLabel(change.after.state)}
                          {change.after.note ? ` (${change.after.note})` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {revision.generalNoteChanged ? (
                    <p className="text-zinc-600 dark:text-zinc-400">
                      Observações gerais: {revision.generalNote || "(vazio)"}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <Link href="/checklists" className="text-sm underline">
          Voltar aos checklists
        </Link>
      </PageShell>
    </>
  );
}
