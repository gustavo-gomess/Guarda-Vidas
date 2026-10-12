import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ActionForm } from "@/components/ui/action-form";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  closingAction,
  saveClosingNotesAction,
} from "@/features/reports/actions";
import {
  ACTION_LABELS,
  REPORT_STATUS_LABELS,
  type ClosingAction,
} from "@/features/reports/closing-rules";
import { SummaryView } from "@/features/reports/components/summary-view";
import { getClosingForActor } from "@/features/reports/queries";
import { toDaySummary } from "@/features/reports/summary";
import { requireActor } from "@/lib/auth/session";
import {
  formatDateTime,
  formatIsoDate,
  isIsoDate,
  operationalToday,
} from "@/lib/dates";

export default function ClosingPage(
  props: PageProps<"/fechamento/[postId]/[date]">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

const KIND_LABELS = {
  SUBMISSION: "Envio",
  CONSOLIDATION: "Consolidação",
  CORRECTION: "Correção",
} as const;

const inputClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

async function Content({ params }: PageProps<"/fechamento/[postId]/[date]">) {
  const actor = await requireActor();
  const { postId, date } = await params;
  if (!z.uuid().safeParse(postId).success || !isIsoDate(date)) notFound();
  const today = operationalToday(new Date());
  const data = await getClosingForActor(actor, postId, date, today);
  // Outside the scope, lifeguards, or unknown post: the same "not found".
  if (!data) notFound();

  const { live, closing } = data;
  const current = closing?.versions[0] ?? null;
  const changedSince =
    current !== null &&
    JSON.stringify(toDaySummary(live)) !== JSON.stringify(current.summary);
  const expectedVersion = closing?.currentVersion ?? 0;

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell
        title={`Fechamento · ${data.post.code} · ${formatIsoDate(date)}`}
      >
        <p className="text-sm">
          {data.post.name} · situação:{" "}
          <strong>{REPORT_STATUS_LABELS[data.report]}</strong>
          {closing ? ` · versão ${closing.currentVersion}` : ""}
          {date > today ? " · dia futuro: ainda não pode ser fechado" : ""}
        </p>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Dados atuais do dia</h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Lidos agora dos registros originais. Podem mudar (ex.: entrada
            sincronizada depois, validação, correção de checklist).
          </p>
          {changedSince ? (
            <p
              role="status"
              className="rounded-md border border-amber-600 px-3 py-2 text-sm"
            >
              Os dados mudaram depois da versão {current?.version} do
              fechamento. Compare abaixo e, se necessário, registre uma
              correção.
            </p>
          ) : null}
          <SummaryView summary={live} detailed />
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={`/presenca/painel?data=${date}&posto=${postId}`}
              className="underline"
            >
              Presença do dia
            </Link>
            <Link
              href={`/checklists?data=${date}&posto=${postId}`}
              className="underline"
            >
              Checklists
            </Link>
            <Link
              href={`/ocorrencias?de=${date}&ate=${date}&posto=${postId}`}
              className="underline"
            >
              Registros
            </Link>
            <Link href={`/alertas?situacao=todos`} className="underline">
              Alertas
            </Link>
          </div>
        </section>

        {data.canClose ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Ações</h2>
            {closing?.status === "DRAFT" || !closing ? (
              <ActionForm
                action={saveClosingNotesAction}
                submitLabel={closing ? "Salvar rascunho" : "Iniciar rascunho"}
                successMessage="Rascunho salvo."
                compact
                className="flex flex-col gap-2"
              >
                <input type="hidden" name="postId" value={postId} />
                <input type="hidden" name="date" value={date} />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Observações do fechamento</span>
                  <textarea
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    defaultValue={closing?.notes ?? ""}
                    className={inputClass}
                  />
                </label>
              </ActionForm>
            ) : null}
            {data.actions.map((action: ClosingAction) => (
              <ActionForm
                key={action}
                action={closingAction}
                submitLabel={ACTION_LABELS[action]}
                successMessage="Versão registrada."
                className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <input type="hidden" name="postId" value={postId} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="action" value={action} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={expectedVersion}
                />
                <p>
                  {action === "SUBMIT"
                    ? `Congela os dados atuais como versão ${expectedVersion + 1}. ${live.pending.total > 0 ? `Vai com ${live.pending.total} pendência(s) identificada(s).` : "Sem pendências."}`
                    : action === "CONSOLIDATE"
                      ? live.pending.total > 0
                        ? `Bloqueado: há ${live.pending.total} pendência(s).`
                        : "Sem pendências: congela a versão final."
                      : "Congela os dados atuais como nova versão; as anteriores continuam visíveis."}
                </p>
                {action === "CORRECT" ? (
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">
                      Motivo da correção (obrigatório)
                    </span>
                    <input
                      name="reason"
                      required
                      minLength={5}
                      maxLength={500}
                      className={inputClass}
                    />
                  </label>
                ) : null}
              </ActionForm>
            ))}
          </section>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Somente consulta.
          </p>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Versões do fechamento</h2>
          {!closing || closing.versions.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Nenhuma versão enviada
              {closing
                ? ` (rascunho iniciado por ${closing.createdBy.name})`
                : ""}
              .
            </p>
          ) : (
            closing.versions.map((version, index) => (
              <details
                key={version.id}
                open={index === 0}
                className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <summary className="cursor-pointer text-sm">
                  <strong>
                    Versão {version.version} · {KIND_LABELS[version.kind]}
                  </strong>{" "}
                  · {formatDateTime(version.createdAt)} · {version.author.name}{" "}
                  · {version.pendingCount} pendência(s)
                </summary>
                <div className="mt-2 flex flex-col gap-2 text-sm">
                  {version.reason ? <p>Motivo: {version.reason}</p> : null}
                  {version.notes ? <p>Observações: {version.notes}</p> : null}
                  <SummaryView summary={version.summary} detailed />
                </div>
              </details>
            ))
          )}
        </section>
        <Link href="/fechamento" className="text-sm underline print:hidden">
          Voltar aos fechamentos
        </Link>
      </PageShell>
    </>
  );
}
