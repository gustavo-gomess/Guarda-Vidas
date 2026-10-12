import {
  MATERIAL_LABELS,
  WARNING_LABELS,
  type DaySummary,
} from "@/features/reports/summary";

type Tone = "ok" | "warn" | "bad" | "neutral";

const toneClass: Record<Tone, string> = {
  ok: "border-green-600/40",
  warn: "border-amber-600/60 bg-amber-50 dark:bg-amber-950/40",
  bad: "border-red-600/60 bg-red-50 dark:bg-red-950/40",
  neutral: "border-zinc-200 dark:border-zinc-800",
};

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className={`flex flex-col rounded-md border p-3 ${toneClass[tone]}`}>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm">{label}</span>
      {hint ? (
        <span className="text-xs text-zinc-600 dark:text-zinc-400">{hint}</span>
      ) : null}
    </div>
  );
}

/**
 * One summary, shown the same way everywhere (panels, live closing, frozen
 * versions). Provisional presence is always labelled as such, never added
 * to the validated number.
 */
export function SummaryView({
  summary,
  detailed = false,
}: {
  summary: DaySummary;
  /** Shows the lists (problems, categories, warnings). */
  detailed?: boolean;
}) {
  const { staffing, presence, checklists, occurrences, alerts, pending } =
    summary;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Escalados" value={staffing.scheduled} />
        <Tile
          label="Presença validada"
          value={presence.validated}
          hint="Oficial"
          tone="ok"
        />
        <Tile
          label="Presença provisória"
          value={presence.provisional}
          hint="Não confirmada: aguarda validação ou em análise"
          tone={presence.provisional > 0 ? "warn" : "neutral"}
        />
        <Tile
          label="Escalados sem entrada"
          value={staffing.absent}
          tone={staffing.absent > 0 ? "warn" : "neutral"}
        />
        <Tile
          label="Registros aguardando decisão"
          value={presence.pendingRecords}
          hint="Entradas, saídas e repetidos"
          tone={presence.pendingRecords > 0 ? "warn" : "neutral"}
        />
        <Tile
          label="Checklists não enviados"
          value={checklists.incomplete + checklists.notStarted}
          hint={`${checklists.incomplete} incompletos · ${checklists.notStarted} não iniciados · ${checklists.submitted} enviados`}
          tone={
            checklists.incomplete + checklists.notStarted > 0
              ? "warn"
              : "neutral"
          }
        />
        <Tile
          label="Problemas de materiais"
          value={checklists.problems}
          hint="Em checklists enviados"
          tone={checklists.problems > 0 ? "bad" : "neutral"}
        />
        <Tile
          label="Registros operacionais"
          value={occurrences.total}
          hint={
            occurrences.annulled > 0
              ? `${occurrences.annulled} anulado(s) fora do total`
              : undefined
          }
        />
        <Tile
          label="Alertas de reforço"
          value={alerts.created}
          hint={`${alerts.active} ativo(s) · ${alerts.closed} encerrado(s) · ${alerts.cancelled} cancelado(s)`}
          tone={alerts.active > 0 ? "bad" : "neutral"}
        />
        <Tile label="Alterações registradas" value={summary.changes} />
        <Tile
          label="Pendências"
          value={pending.total}
          hint="Impedem consolidar o fechamento"
          tone={pending.total > 0 ? "warn" : "ok"}
        />
      </div>

      {detailed ? (
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <section>
            <h3 className="font-medium">Avisos</h3>
            {summary.warnings.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">Nenhum.</p>
            ) : (
              <ul className="list-disc pl-5">
                {summary.warnings.map((warning) => (
                  <li key={warning}>{WARNING_LABELS[warning]}</li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="font-medium">Registros por categoria</h3>
            {occurrences.byCategory.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">Nenhum.</p>
            ) : (
              <ul className="list-disc pl-5">
                {occurrences.byCategory.map((category) => (
                  <li key={category.name}>
                    {category.name}: {category.count}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="md:col-span-2">
            <h3 className="font-medium">Materiais com problema</h3>
            {checklists.problemItems.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">Nenhum.</p>
            ) : (
              <ul className="list-disc pl-5">
                {checklists.problemItems.map((item, index) => (
                  <li key={`${item.label}-${item.person}-${index}`}>
                    {item.label}: {MATERIAL_LABELS[item.state]} (registrado por{" "}
                    {item.person})
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
