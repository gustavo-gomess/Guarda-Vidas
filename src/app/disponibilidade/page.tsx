import Link from "next/link";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { Field, TextAreaField } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  openWindowAction,
  setWindowStatusAction,
  submitAvailabilityAction,
} from "@/features/availability/actions";
import { listWindows } from "@/features/availability/queries";
import {
  WINDOW_STATUS_LABELS,
  windowDays,
  windowEnd,
} from "@/features/schedules/rules";
import {
  canManageAvailabilityWindows,
  canSubmitAvailability,
  canViewAvailability,
  type Actor,
} from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatIsoDate, operationalToday } from "@/lib/dates";

export default function AvailabilityPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

type WindowView = Awaited<ReturnType<typeof listWindows>>[number];

function period(startDate: string) {
  return `${formatIsoDate(startDate)} a ${formatIsoDate(windowEnd(startDate))}`;
}

async function Content() {
  const actor = await requireActor();
  const windows = await listWindows(actor);
  const today = operationalToday(new Date());

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Disponibilidade">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A disponibilidade é declarada em janelas de três dias. Ela é só uma
          declaração: a escala é montada e confirmada pela coordenação.
        </p>
        {canSubmitAvailability(actor) ? (
          <LifeguardView windows={windows} today={today} />
        ) : (
          <ManagerView actor={actor} windows={windows} today={today} />
        )}
      </PageShell>
    </>
  );
}

function LifeguardView({
  windows,
  today,
}: {
  windows: WindowView[];
  today: string;
}) {
  const open = windows.filter((window) => window.status === "OPEN");
  const past = windows.filter((window) => window.status === "CLOSED");

  return (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Janelas abertas</h2>
        {open.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhuma janela aberta no momento. A coordenação avisa quando abrir a
            próxima.
          </p>
        ) : null}
        {open.map((window) => (
          <article
            key={window.id}
            className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h3 className="font-medium">{period(window.startDate)}</h3>
            <p className="text-sm">
              {window.mine
                ? `Enviada em ${formatDateTime(window.mine.submittedAt)}${
                    window.mine.updatedAt.getTime() !==
                    window.mine.submittedAt.getTime()
                      ? `, atualizada em ${formatDateTime(window.mine.updatedAt)}`
                      : ""
                  }. Você pode alterar enquanto a janela estiver aberta.`
                : "Ainda não enviada."}
            </p>
            <ActionForm
              action={submitAvailabilityAction}
              submitLabel={
                window.mine
                  ? "Atualizar disponibilidade"
                  : "Enviar disponibilidade"
              }
              successMessage="Disponibilidade registrada."
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="windowId" value={window.id} />
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">
                  Marque os dias em que você está disponível
                </legend>
                {windowDays(window.startDate).map((date, index) => {
                  const key = `day${index + 1}` as "day1" | "day2" | "day3";
                  return (
                    <label key={date} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={key}
                        defaultChecked={window.mine?.[key] ?? false}
                        className="size-5"
                      />
                      {formatIsoDate(date)}
                      {date < today ? " (já passou)" : ""}
                    </label>
                  );
                })}
              </fieldset>
              <TextAreaField
                label="Observação (opcional)"
                name="note"
                maxLength={300}
                defaultValue={window.mine?.note ?? ""}
              />
            </ActionForm>
          </article>
        ))}
      </section>

      {past.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Janelas encerradas</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {past.map((window) => (
              <li key={window.id}>
                {period(window.startDate)} ·{" "}
                {window.mine
                  ? windowDays(window.startDate)
                      .filter(
                        (_date, index) =>
                          window.mine?.[
                            `day${index + 1}` as "day1" | "day2" | "day3"
                          ],
                      )
                      .map(formatIsoDate)
                      .join(", ") || "indisponível nos três dias"
                  : "não enviada"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function ManagerView({
  actor,
  windows,
  today,
}: {
  actor: Actor;
  windows: WindowView[];
  today: string;
}) {
  const manage = canManageAvailabilityWindows(actor);
  return (
    <>
      {manage ? (
        <section className="flex max-w-sm flex-col gap-3">
          <h2 className="text-lg font-semibold">Abrir janela</h2>
          <ActionForm
            action={openWindowAction}
            submitLabel="Abrir janela de três dias"
            successMessage="Janela aberta. Os guarda-vidas já podem enviar."
            className="flex flex-col gap-3"
          >
            <Field
              label="Primeiro dia"
              name="startDate"
              type="date"
              min={today}
              required
            />
          </ActionForm>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Janelas</h2>
        {windows.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhuma janela de disponibilidade foi aberta ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {windows.map((window) => (
              <li key={window.id} className="flex flex-wrap items-center gap-3">
                {canViewAvailability(actor) ? (
                  <Link
                    href={`/disponibilidade/${window.id}`}
                    className="underline"
                  >
                    {period(window.startDate)}
                  </Link>
                ) : (
                  period(window.startDate)
                )}
                <span className="text-sm text-zinc-500">
                  {WINDOW_STATUS_LABELS[window.status]} · aberta por{" "}
                  {window.createdBy.name}
                </span>
                {manage ? (
                  <ActionForm
                    action={setWindowStatusAction}
                    submitLabel={
                      window.status === "OPEN" ? "Encerrar" : "Reabrir"
                    }
                    compact
                  >
                    <input type="hidden" name="windowId" value={window.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={window.status === "OPEN" ? "CLOSED" : "OPEN"}
                    />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
