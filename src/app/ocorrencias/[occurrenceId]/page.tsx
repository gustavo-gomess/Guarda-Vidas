import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ActionForm } from "@/components/ui/action-form";
import { AuditList } from "@/components/ui/audit-list";
import { Field } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { annulOccurrenceAction } from "@/features/occurrences/actions";
import { formatValue } from "@/features/occurrences/fields";
import { getOccurrenceForActor } from "@/features/occurrences/queries";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";

export default function OccurrencePage(
  props: PageProps<"/ocorrencias/[occurrenceId]">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<"/ocorrencias/[occurrenceId]">) {
  const actor = await requireActor();
  const id = z.uuid().safeParse((await params).occurrenceId);
  if (!id.success) notFound();
  const record = await getOccurrenceForActor(actor, id.data);
  if (!record) notFound();

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={`${record.categoryVersion.name} · ${record.post.code}`}>
        {record.annulment ? (
          <p
            role="status"
            className="rounded-md border border-amber-600 px-3 py-2 text-sm"
          >
            ANULADO por {record.annulment.by.name} em{" "}
            {formatDateTime(record.annulment.createdAt)}:{" "}
            {record.annulment.reason}. O conteúdo original continua abaixo.
          </p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">Posto</dt>
          <dd>
            {record.post.code} · {record.post.name}
          </dd>
          <dt className="font-medium">Quando aconteceu</dt>
          <dd>{formatDateTime(record.occurredAt)} (informado pelo autor)</dd>
          <dt className="font-medium">Registrado</dt>
          <dd>
            {formatDateTime(record.recordedAt)} por {record.author.name}
          </dd>
          {record.categoryVersion.fields.map((field) => (
            <div key={field.key} className="contents">
              <dt className="font-medium">{field.label}</dt>
              <dd>{formatValue(field, record.values[field.key] ?? null)}</dd>
            </div>
          ))}
          <dt className="font-medium">Descrição</dt>
          <dd className="whitespace-pre-line">{record.description || "—"}</dd>
        </dl>
        <p className="text-xs text-zinc-500">
          Campos da versão {record.categoryVersion.version} da categoria, como
          eram no momento do registro.
        </p>

        {record.canAnnul ? (
          <section className="flex max-w-md flex-col gap-2">
            <h2 className="text-lg font-semibold">Anular registro</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Use só para registro feito por engano. Ele continua visível,
              marcado como anulado.
            </p>
            <ActionForm
              action={annulOccurrenceAction}
              submitLabel="Anular"
              successMessage="Registro anulado."
              compact
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="occurrenceId" value={record.id} />
              <Field
                label="Motivo (obrigatório)"
                name="reason"
                required
                minLength={5}
                maxLength={500}
              />
            </ActionForm>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Histórico</h2>
          <AuditList entries={record.audit} />
        </section>
        <Link href="/ocorrencias" className="text-sm underline">
          Voltar aos registros
        </Link>
      </PageShell>
    </>
  );
}
