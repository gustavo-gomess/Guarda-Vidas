import { PROBLEM_STATES } from "@/features/checklists/rules";
import {
  summarizePostDay,
  type MaterialProblem,
  type PostDaySummary,
  type RawPostDay,
} from "@/features/reports/summary";
import type { Prisma } from "@/generated/prisma/client";
import {
  addDays,
  daysBetween,
  fromDbDate,
  operationalRange,
  operationalToday,
  toDbDate,
} from "@/lib/dates";

/**
 * Reads the day's data of every module for some posts and a period, in a
 * fixed number of queries, and summarizes each post-day with
 * summarizePostDay. Works with the client or inside a transaction (the
 * closing freezes exactly what it read). Never writes.
 */

type Db = Prisma.TransactionClient;

const PUBLISHED: Prisma.EnumScheduleStatusFilter = {
  in: ["CONFIRMED", "CHANGED"],
};

export type LoadedPost = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export async function loadSummaries(
  db: Db,
  scope: { postIds?: readonly string[] },
  from: string,
  to: string,
): Promise<{ posts: LoadedPost[]; summaries: PostDaySummary[] }> {
  const posts = await db.post.findMany({
    where: {
      ...(scope.postIds ? { id: { in: [...scope.postIds] } } : {}),
      status: { not: "INACTIVE" },
    },
    select: { id: true, code: true, name: true, status: true },
    orderBy: { name: "asc" },
  });
  if (posts.length === 0) return { posts, summaries: [] };
  const postIds = posts.map((post) => post.id);
  const dates = { gte: toDbDate(from), lte: toDbDate(to) };
  const instants = operationalRange(from, to);

  const [entries, journeys, occurrences, alerts, audit] = await Promise.all([
    db.scheduleEntry.findMany({
      where: {
        date: dates,
        schedule: { status: PUBLISHED, postId: { in: postIds } },
      },
      select: {
        date: true,
        userId: true,
        user: { select: { name: true } },
        schedule: { select: { postId: true } },
      },
    }),
    db.journey.findMany({
      where: { date: dates, postId: { in: postIds } },
      select: {
        date: true,
        postId: true,
        userId: true,
        user: { select: { name: true } },
        records: { select: { kind: true, primaryKind: true, status: true } },
        checklist: {
          select: {
            status: true,
            currentRevision: {
              select: {
                answers: {
                  where: { state: { in: [...PROBLEM_STATES] } },
                  select: { state: true, line: { select: { label: true } } },
                },
              },
            },
          },
        },
      },
    }),
    db.occurrence.findMany({
      where: { postId: { in: postIds }, occurredAt: instants },
      select: {
        postId: true,
        occurredAt: true,
        categoryVersion: { select: { name: true } },
        annulment: { select: { id: true } },
      },
    }),
    db.reinforcementAlert.findMany({
      where: { postId: { in: postIds }, createdAt: instants },
      select: { postId: true, createdAt: true, status: true },
    }),
    db.auditLog.findMany({
      where: { postId: { in: postIds }, createdAt: instants },
      select: { postId: true, createdAt: true },
    }),
  ]);

  const raw = new Map<string, RawPostDay>();
  const key = (postId: string, date: string) => `${postId}|${date}`;
  const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) =>
    addDays(from, i),
  );
  for (const post of posts) {
    for (const date of days) {
      raw.set(key(post.id, date), {
        postId: post.id,
        date,
        postOperating: post.status === "OPERATING",
        scheduled: [],
        journeys: [],
        occurrences: [],
        alerts: [],
        changes: 0,
      });
    }
  }
  const at = (postId: string, date: string) => raw.get(key(postId, date));

  for (const entry of entries) {
    at(entry.schedule.postId, fromDbDate(entry.date))?.scheduled.push({
      userId: entry.userId,
      name: entry.user.name,
    });
  }
  for (const journey of journeys) {
    at(journey.postId, fromDbDate(journey.date))?.journeys.push({
      userId: journey.userId,
      name: journey.user.name,
      records: journey.records.map((record) => ({
        kind: record.kind,
        primary: record.primaryKind !== null,
        status: record.status,
      })),
      checklist: journey.checklist && {
        status: journey.checklist.status,
        problems:
          journey.checklist.currentRevision?.answers.map((answer) => ({
            label: answer.line.label,
            state: answer.state as MaterialProblem,
          })) ?? [],
      },
    });
  }
  for (const occurrence of occurrences) {
    at(
      occurrence.postId,
      operationalToday(occurrence.occurredAt),
    )?.occurrences.push({
      category: occurrence.categoryVersion.name,
      annulled: occurrence.annulment !== null,
    });
  }
  for (const alert of alerts) {
    at(alert.postId, operationalToday(alert.createdAt))?.alerts.push({
      status: alert.status,
    });
  }
  for (const entry of audit) {
    if (!entry.postId) continue;
    const day = at(entry.postId, operationalToday(entry.createdAt));
    if (day) day.changes++;
  }

  return { posts, summaries: [...raw.values()].map(summarizePostDay) };
}
