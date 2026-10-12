import "server-only";

import {
  availableClosingActions,
  reportNeeds,
  type ClosingStatus,
  type ReportStatus,
} from "@/features/reports/closing-rules";
import { loadSummaries } from "@/features/reports/load";
import {
  sumSummaries,
  type DaySummary,
  type PostDaySummary,
} from "@/features/reports/summary";
import { managedPostIds } from "@/features/schedules/scope";
import { canCloseDay, canViewReports, type Actor } from "@/lib/auth/policy";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { getDb } from "@/lib/db";

/**
 * Panels and closings. Everything is built from loadSummaries, so the
 * coordinator, the authority and the closing see the same numbers.
 * Coordinators: their area. Authority and administrators: all, read-only.
 */

export type ReportFilters = { from: string; to: string; postId?: string };

/** Post ids the actor may see in reports; null when none (lifeguards). */
function scopeFor(
  actor: Actor,
  postId?: string,
): { postIds?: readonly string[] } | null {
  if (!canViewReports(actor)) return null;
  const allowed = managedPostIds(actor);
  if (postId) {
    if (allowed && !allowed.includes(postId)) return { postIds: [] };
    return { postIds: [postId] };
  }
  return allowed ? { postIds: allowed } : {};
}

export type OverviewRow = PostDaySummary & {
  report: ReportStatus;
  needs: "SEND" | "CONSOLIDATE" | null;
};

export async function getOverview(
  actor: Actor,
  filters: ReportFilters,
  today: string,
) {
  const scope = scopeFor(actor, filters.postId);
  if (!scope) return null;
  const db = getDb();
  const { posts, summaries } = await loadSummaries(
    db,
    scope,
    filters.from,
    filters.to,
  );
  const closings = await db.dailyClosing.findMany({
    where: {
      postId: { in: posts.map((post) => post.id) },
      date: { gte: toDbDate(filters.from), lte: toDbDate(filters.to) },
    },
    select: { postId: true, date: true, status: true },
  });
  const statusOf = new Map(
    closings.map((closing) => [
      `${closing.postId}|${fromDbDate(closing.date)}`,
      closing.status,
    ]),
  );

  const rows: OverviewRow[] = summaries.map((summary) => {
    const report: ReportStatus =
      statusOf.get(`${summary.postId}|${summary.date}`) ?? "NOT_STARTED";
    // Future days have nothing to close yet.
    return {
      ...summary,
      report,
      needs: summary.date <= today ? reportNeeds(report) : null,
    };
  });

  const byPost = posts.map((post) => {
    const postRows = rows.filter((row) => row.postId === post.id);
    return { post, total: sumSummaries(postRows), rows: postRows };
  });

  return {
    posts,
    rows,
    byPost,
    total: sumSummaries(rows),
    reportsToSend: rows.filter((row) => row.needs === "SEND").length,
    reportsToConsolidate: rows.filter((row) => row.needs === "CONSOLIDATE")
      .length,
  };
}

/** Teams of the coordinator's posts (panel). */
export async function listTeams(actor: Actor) {
  if (!canViewReports(actor)) return null;
  const allowed = managedPostIds(actor);
  return getDb().post.findMany({
    where: {
      ...(allowed ? { id: { in: [...allowed] } } : {}),
      status: { not: "INACTIVE" },
    },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      assignments: {
        where: { user: { active: true } },
        select: { isCaptain: true, user: { select: { name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

/** One post-day: live summary, closing state, every frozen version. */
export async function getClosingForActor(
  actor: Actor,
  postId: string,
  date: string,
  today: string,
) {
  const scope = scopeFor(actor, postId);
  if (!scope || scope.postIds?.length === 0) return null;
  const db = getDb();
  const { posts, summaries } = await loadSummaries(db, scope, date, date);
  const post = posts[0];
  const live = summaries[0];
  if (!post || !live) return null;

  const closing = await db.dailyClosing.findUnique({
    where: { postId_date: { postId, date: toDbDate(date) } },
    select: {
      status: true,
      notes: true,
      currentVersion: true,
      createdBy: { select: { name: true } },
      createdAt: true,
      versions: {
        select: {
          id: true,
          version: true,
          kind: true,
          summary: true,
          pendingCount: true,
          notes: true,
          reason: true,
          createdAt: true,
          author: { select: { name: true } },
        },
        orderBy: { version: "desc" },
      },
    },
  });
  const status: ClosingStatus | null = closing?.status ?? null;
  const canClose = canCloseDay(actor, postId) && date <= today;

  return {
    post,
    date,
    live,
    closing: closing && {
      ...closing,
      versions: closing.versions.map((version) => ({
        ...version,
        summary: version.summary as unknown as DaySummary,
      })),
    },
    report: (status ?? "NOT_STARTED") as ReportStatus,
    canClose,
    actions: canClose ? availableClosingActions(status) : [],
  };
}
