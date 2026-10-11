import "server-only";

import {
  diffSnapshots,
  PROBLEM_STATES,
  progressOf,
  type ChecklistProgress,
  type ItemState,
} from "@/features/checklists/rules";
import { postScope } from "@/features/schedules/scope";
import {
  canFillChecklist,
  canManageChecklistItems,
  canViewAvailability,
  canViewPost,
  canViewPostSchedules,
  type Actor,
} from "@/lib/auth/policy";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { getDb } from "@/lib/db";

/**
 * Checklist data. The lifeguard sees their own checklists; the coordination
 * sees the posts of its area; authority and administrators see everything.
 * Records belong to the post's history: authors are shown, never owners.
 */

const progressFields = {
  status: true,
  submittedAt: true,
  currentRevision: {
    select: { answers: { select: { state: true } } },
  },
} as const;

function problemCount(
  checklist: {
    currentRevision: { answers: { state: ItemState | null }[] } | null;
  } | null,
) {
  return (
    checklist?.currentRevision?.answers.filter(
      (answer) =>
        answer.state !== null && PROBLEM_STATES.includes(answer.state),
    ).length ?? 0
  );
}

/** The lifeguard's recent journeys and the state of each checklist. */
export async function listMyChecklists(actor: Actor) {
  if (actor.role !== "LIFEGUARD") return null;
  const journeys = await getDb().journey.findMany({
    where: { userId: actor.id },
    select: {
      id: true,
      date: true,
      post: { select: { code: true, name: true } },
      checklist: { select: progressFields },
    },
    orderBy: { date: "desc" },
    take: 15,
  });
  return journeys.map((journey) => ({
    id: journey.id,
    date: fromDbDate(journey.date),
    post: journey.post,
    progress: progressOf(journey.checklist),
    problems: problemCount(journey.checklist),
  }));
}

export type OverviewFilters = {
  date: string;
  postId?: string;
  progress?: ChecklistProgress;
};

/** Every assumption of a day: pending, incomplete or sent. */
export async function listChecklistOverview(
  actor: Actor,
  filters: OverviewFilters,
) {
  if (!canViewAvailability(actor)) return null;
  const posts = postScope(actor, filters.postId);
  const journeys = await getDb().journey.findMany({
    where: {
      date: toDbDate(filters.date),
      ...(posts ? { postId: posts } : {}),
    },
    select: {
      id: true,
      user: { select: { name: true } },
      post: { select: { code: true, name: true } },
      checklist: { select: progressFields },
    },
    orderBy: [{ post: { name: "asc" } }, { user: { name: "asc" } }],
  });
  return journeys
    .map((journey) => ({
      id: journey.id,
      user: journey.user,
      post: journey.post,
      progress: progressOf(journey.checklist),
      submittedAt: journey.checklist?.submittedAt ?? null,
      problems: problemCount(journey.checklist),
    }))
    .filter((row) => !filters.progress || row.progress === filters.progress);
}

/**
 * One journey's checklist with its full history. Null when the actor may
 * not see it (another lifeguard's, or outside the area).
 */
export async function getChecklistForActor(actor: Actor, journeyId: string) {
  const db = getDb();
  const journey = await db.journey.findUnique({
    where: { id: journeyId },
    select: {
      id: true,
      date: true,
      userId: true,
      postId: true,
      user: { select: { name: true } },
      post: { select: { code: true, name: true } },
      checklist: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          submittedAt: true,
          currentRevisionId: true,
          lines: {
            select: { id: true, label: true, guidance: true, position: true },
            orderBy: { position: "asc" },
          },
          revisions: {
            select: {
              id: true,
              number: true,
              kind: true,
              createdAt: true,
              generalNote: true,
              reason: true,
              author: { select: { name: true } },
              answers: { select: { lineId: true, state: true, note: true } },
            },
            orderBy: { number: "asc" },
          },
        },
      },
    },
  });
  if (!journey) return null;
  const own = journey.userId === actor.id;
  if (!own && !canViewPostSchedules(actor, journey.postId)) return null;

  const hasItems =
    journey.checklist !== null ||
    (await db.checklistItemVersion.count({
      where: { item: { postId: journey.postId }, active: true },
    })) > 0;

  const checklist = journey.checklist;
  const revisions = checklist?.revisions ?? [];
  const history = revisions.map((revision, index) => ({
    ...revision,
    ...diffSnapshots(revisions[index - 1] ?? null, revision),
  }));
  const current = revisions.find(
    (revision) => revision.id === checklist?.currentRevisionId,
  );

  return {
    id: journey.id,
    date: fromDbDate(journey.date),
    postId: journey.postId,
    user: journey.user,
    post: journey.post,
    canFill: canFillChecklist(actor, journey.userId),
    hasItems,
    progress: progressOf(checklist),
    checklist: checklist && {
      id: checklist.id,
      status: checklist.status,
      createdAt: checklist.createdAt,
      submittedAt: checklist.submittedAt,
      lines: checklist.lines,
      current: current
        ? { generalNote: current.generalNote, answers: current.answers }
        : null,
      history: history.reverse(),
    },
  };
}

export type ProblemFilters = {
  from: string;
  to: string;
  postId?: string;
  state?: ItemState;
};

/**
 * Material problems in the current answers of sent checklists: what is
 * missing, damaged or inadequate, where, when and reported by whom.
 */
export async function listMaterialProblems(
  actor: Actor,
  filters: ProblemFilters,
) {
  if (!canViewAvailability(actor)) return null;
  const posts = postScope(actor, filters.postId);
  const answers = await getDb().checklistAnswer.findMany({
    where: {
      state: filters.state ? filters.state : { in: [...PROBLEM_STATES] },
      revision: {
        currentOf: {
          status: "SUBMITTED",
          date: { gte: toDbDate(filters.from), lte: toDbDate(filters.to) },
          ...(posts ? { postId: posts } : {}),
        },
      },
    },
    select: {
      state: true,
      note: true,
      line: { select: { label: true, itemId: true } },
      revision: {
        select: {
          kind: true,
          createdAt: true,
          author: { select: { name: true } },
          currentOf: {
            select: {
              journeyId: true,
              date: true,
              post: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
    take: 500,
  });
  return answers
    .flatMap(({ revision, ...answer }) =>
      revision.currentOf
        ? [
            {
              state: answer.state as ItemState,
              note: answer.note,
              label: answer.line.label,
              itemId: answer.line.itemId,
              author: revision.author.name,
              recordedAt: revision.createdAt,
              corrected: revision.kind === "CORRECTION",
              journeyId: revision.currentOf.journeyId,
              date: fromDbDate(revision.currentOf.date),
              post: revision.currentOf.post,
            },
          ]
        : [],
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.post.name.localeCompare(b.post.name) ||
        a.label.localeCompare(b.label),
    );
}

/** The post's items with every version (newest first). */
export async function getPostItems(actor: Actor, postId: string) {
  if (!canViewPost(actor, postId) && !canViewPostSchedules(actor, postId)) {
    return null;
  }
  const items = await getDb().checklistItem.findMany({
    where: { postId },
    select: {
      id: true,
      versions: {
        select: {
          id: true,
          version: true,
          label: true,
          guidance: true,
          position: true,
          active: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
        orderBy: { version: "desc" },
      },
    },
  });
  return {
    canManage: canManageChecklistItems(actor, postId),
    items: items
      .filter((item) => item.versions.length > 0)
      .map((item) => ({
        id: item.id,
        current: item.versions[0]!,
        versions: item.versions,
      }))
      .sort(
        (a, b) =>
          Number(b.current.active) - Number(a.current.active) ||
          a.current.position - b.current.position ||
          a.current.label.localeCompare(b.current.label),
      ),
  };
}
