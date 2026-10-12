import Link from "next/link";

import { REPORT_STATUS_LABELS } from "@/features/reports/closing-rules";
import type { OverviewRow } from "@/features/reports/queries";
import { formatIsoDate } from "@/lib/dates";

/**
 * Post-day rows of the panels. Same numbers as the closing page, because
 * both come from summarizePostDay.
 */
export function OverviewTable({
  rows,
  posts,
}: {
  rows: OverviewRow[];
  posts: { id: string; code: string; name: string }[];
}) {
  const codeOf = new Map(posts.map((post) => [post.id, post.code]));
  if (rows.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        Nenhum posto no período e filtros escolhidos.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className="py-2 pr-3">Dia</th>
            <th className="py-2 pr-3">Posto</th>
            <th className="py-2 pr-3" title="Escalados">
              Esc.
            </th>
            <th className="py-2 pr-3">Validada</th>
            <th className="py-2 pr-3">Provisória</th>
            <th className="py-2 pr-3">Sem entrada</th>
            <th className="py-2 pr-3">Checklists pend.</th>
            <th className="py-2 pr-3">Materiais</th>
            <th className="py-2 pr-3">Registros</th>
            <th className="py-2 pr-3">Alertas ativos</th>
            <th className="py-2 pr-3">Fechamento</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.postId}-${row.date}`}
              className="border-b border-zinc-100 dark:border-zinc-900"
            >
              <td className="py-2 pr-3 whitespace-nowrap">
                {formatIsoDate(row.date)}
              </td>
              <td className="py-2 pr-3">
                {codeOf.get(row.postId)}
                {row.warnings.includes("NO_SCHEDULE") ? (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">
                    sem escala
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {row.staffing.scheduled}
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {row.presence.validated}
              </td>
              <td
                className={`py-2 pr-3 tabular-nums ${row.presence.provisional ? "text-amber-700 dark:text-amber-400" : ""}`}
              >
                {row.presence.provisional}
              </td>
              <td
                className={`py-2 pr-3 tabular-nums ${row.staffing.absent ? "text-amber-700 dark:text-amber-400" : ""}`}
              >
                {row.staffing.absent}
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {row.checklists.incomplete + row.checklists.notStarted}
              </td>
              <td
                className={`py-2 pr-3 tabular-nums ${row.checklists.problems ? "text-red-700 dark:text-red-400" : ""}`}
              >
                {row.checklists.problems}
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {row.occurrences.total}
              </td>
              <td
                className={`py-2 pr-3 tabular-nums ${row.alerts.active ? "font-semibold text-red-700 dark:text-red-400" : ""}`}
              >
                {row.alerts.active}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <Link
                  href={`/fechamento/${row.postId}/${row.date}`}
                  className="underline"
                >
                  {REPORT_STATUS_LABELS[row.report]}
                </Link>
                {row.needs === "SEND" ? (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">
                    pendente de envio
                  </span>
                ) : row.needs === "CONSOLIDATE" ? (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">
                    pendente de consolidação
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
