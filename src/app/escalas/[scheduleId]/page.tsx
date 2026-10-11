import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { AuditList } from "@/components/ui/audit-list";
import { Field } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { POST_STATUS_LABELS } from "@/features/posts/status";
import {
  addEntryAction,
  confirmScheduleAction,
  removeEntryAction,
} from "@/features/schedules/actions";
import {
  getScheduleForActor,
  listScheduleAudit,
} from "@/features/schedules/queries";
import {
  AVAILABILITY_LABELS,
  MIN_REASON_LENGTH,
  SCHEDULE_STATUS_LABELS,
  windowEnd,
} from "@/features/schedules/rules";
import { scheduleIdSchema } from "@/features/schedules/schemas";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatIsoDate, operationalToday } from "@/lib/dates";

export default function SchedulePage(
  props: PageProps<"/escalas/[scheduleId]">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

const selectClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

async function Content({ params }: PageProps<"/escalas/[scheduleId]">) {
  const actor = await requireActor();
  const parsedId = scheduleIdSchema.safeParse((await params).scheduleId);
  if (!parsedId.success) notFound();
  const schedule = await getScheduleForActor(actor, parsedId.data);
  // Unknown, outside the area, or a lifeguard: the same "not found".
  if (!schedule) notFound();
  const audit = await listScheduleAudit(actor, schedule.id);
  const today = operationalToday(new Date());
  const { canManage, published } = schedule;
  const postOperating = schedule.post.status === "OPERATING";

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell
        title={`Escala ${schedule.post.code} · ${schedule.post.name} · ${formatIsoDate(schedule.window.startDate)} a ${formatIsoDate(windowEnd(schedule.window.startDate))}`}
      >
        <section className="flex flex-col gap-1 text-sm">
          <p>
            <span className="font-medium">Situação:</span>{" "}
            {SCHEDULE_STATUS_LABELS[schedule.status]}
            {schedule.confirmedAt
              ? ` · confirmada em ${formatDateTime(schedule.confirmedAt)} por ${schedule.confirmedBy?.name ?? "—"}`
              : ""}
          </p>
          {!postOperating ? (
            <p className="text-amber-700 dark:text-amber-400">
              Posto {POST_STATUS_LABELS[schedule.post.status].toLowerCase()}:
              não é possível incluir guarda-vidas.
            </p>
          ) : null}
          {canManage && published ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Esta escala já foi publicada. Cada alteração exige justificativa e
              fica no histórico.
            </p>
          ) : null}
          {!canManage ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Somente consulta.
            </p>
          ) : null}
          <Link
            href={`/disponibilidade/${schedule.window.id}?posto=${schedule.post.id}`}
            className="underline"
          >
            Ver disponibilidade da equipe
          </Link>
        </section>

        {schedule.days.map((day) => {
          const editable = canManage && day.date >= today;
          return (
            <section key={day.date} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">
                {formatIsoDate(day.date)}
                {day.date < today ? " (já passou)" : ""}
              </h2>
              {day.entries.length === 0 ? (
                <p className="text-zinc-600 dark:text-zinc-400">
                  Ninguém escalado neste dia.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {day.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center gap-3"
                    >
                      <span>
                        {entry.user.name}
                        {entry.user.active ? "" : " (inativo)"}
                        <span className="text-sm text-zinc-500">
                          {" "}
                          · {AVAILABILITY_LABELS[entry.availability]}
                        </span>
                      </span>
                      {editable ? (
                        <ActionForm
                          action={removeEntryAction}
                          submitLabel="Retirar"
                          compact
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input
                            type="hidden"
                            name="entryId"
                            value={entry.id}
                          />
                          {published ? (
                            <input
                              name="reason"
                              required
                              minLength={MIN_REASON_LENGTH}
                              maxLength={500}
                              placeholder="Justificativa"
                              aria-label={`Justificativa para retirar ${entry.user.name}`}
                              className={selectClass}
                            />
                          ) : null}
                        </ActionForm>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {editable && postOperating ? (
                day.candidates.length === 0 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Toda a equipe ativa já está neste dia, ou o posto não tem
                    equipe.{" "}
                    <Link
                      href={`/postos/${schedule.post.id}`}
                      className="underline"
                    >
                      Gerenciar equipe
                    </Link>
                  </p>
                ) : (
                  <ActionForm
                    action={addEntryAction}
                    submitLabel="Escalar"
                    compact
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input
                      type="hidden"
                      name="scheduleId"
                      value={schedule.id}
                    />
                    <input type="hidden" name="date" value={day.date} />
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Guarda-vidas</span>
                      <select name="userId" required className={selectClass}>
                        {day.candidates.map((candidate) => (
                          <option
                            key={candidate.id}
                            value={candidate.id}
                            disabled={candidate.busyAt !== null}
                          >
                            {candidate.name} —{" "}
                            {candidate.busyAt
                              ? `já escalado no posto ${candidate.busyAt}`
                              : AVAILABILITY_LABELS[candidate.availability]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label={
                        published
                          ? "Justificativa (obrigatória)"
                          : "Justificativa (se não declarou disponibilidade)"
                      }
                      name="reason"
                      maxLength={500}
                      required={published}
                      className="py-1 text-sm"
                    />
                  </ActionForm>
                )
              ) : null}
            </section>
          );
        })}

        {canManage && schedule.status === "PROPOSED" ? (
          <section className="flex flex-col gap-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-lg font-semibold">Confirmar escala</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Revise os três dias. Ao confirmar, a escala é publicada para os
              guarda-vidas. Depois disso, cada alteração exige justificativa.
            </p>
            <ActionForm
              action={confirmScheduleAction}
              submitLabel="Confirmar e publicar"
              successMessage="Escala confirmada e publicada."
            >
              <input type="hidden" name="scheduleId" value={schedule.id} />
            </ActionForm>
          </section>
        ) : null}

        {audit ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Histórico de alterações</h2>
            <AuditList entries={audit} />
          </section>
        ) : null}
      </PageShell>
    </>
  );
}
