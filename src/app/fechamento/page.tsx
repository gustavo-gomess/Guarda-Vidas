import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { listVisiblePosts } from "@/features/posts/queries";
import {
  REPORT_STATUS_LABELS,
  type ReportStatus,
} from "@/features/reports/closing-rules";
import { OverviewTable } from "@/features/reports/components/overview-table";
import { getOverview } from "@/features/reports/queries";
import { FilterForm } from "@/features/schedules/components/filter-form";
import { parseScheduleFilters } from "@/features/schedules/schemas";
import { requireActor } from "@/lib/auth/session";
import { addDays, operationalToday } from "@/lib/dates";

export default function ClosingsPage(props: PageProps<"/fechamento">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<"/fechamento">) {
  const actor = await requireActor();
  const today = operationalToday(new Date());
  const { filters, errors } = parseScheduleFilters(
    { de: addDays(today, -6), ate: today, ...(await searchParams) },
    today,
  );
  const overview = await getOverview(actor, filters, today);
  if (!overview) notFound();
  const posts = await listVisiblePosts(actor);
  // Most recent first for closings.
  const rows = [...overview.rows].sort(
    (a, b) => b.date.localeCompare(a.date) || a.postId.localeCompare(b.postId),
  );
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.report] = (acc[row.report] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Fechamento diário">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Um fechamento por posto e dia. Ele congela um resumo dos registros em
          versões; os registros originais nunca são alterados.
        </p>
        <FilterForm
          action="/fechamento"
          posts={posts}
          showDates
          values={{ de: filters.from, ate: filters.to, posto: filters.postId }}
        />
        {errors.length > 0 ? (
          <ul role="alert" className="text-sm text-amber-700">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm">
          {(Object.keys(REPORT_STATUS_LABELS) as ReportStatus[])
            .map(
              (status) =>
                `${REPORT_STATUS_LABELS[status]}: ${counts[status] ?? 0}`,
            )
            .join(" · ")}
        </p>
        <OverviewTable rows={rows} posts={overview.posts} />
      </PageShell>
    </>
  );
}
