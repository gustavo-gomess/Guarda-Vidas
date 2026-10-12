/**
 * The single definition of a post's day in numbers. Every panel, the
 * closing and its frozen versions use summarizePostDay and sumSummaries,
 * so the same indicator can never be computed two ways.
 *
 * Rules (also in docs/ARCHITECTURE.md › Indicadores):
 * - Presence counts the journey's ENTRY: validated = official; provisional
 *   = awaiting validation or under review (never shown as confirmed);
 *   rejected is kept apart.
 * - Pending records count every record (entry, exit, duplicate) still
 *   awaiting a decision.
 * - Checklists: one per journey; material problems only from SENT
 *   checklists' current answers (same rule as the problems screen).
 * - Occurrences: annulled records are counted apart, never in the total.
 * - Alerts: those created on the day; "active" = not closed or cancelled.
 * - Pending items (block consolidation, OD-15): provisional records,
 *   checklists not sent, active alerts. Warnings (do not block): no
 *   schedule, scheduled without entry, entry without exit, unscheduled.
 */

export const SUMMARY_SCHEMA = 1;

export type RecordStatus =
  "AWAITING_VALIDATION" | "VALIDATED" | "REJECTED" | "UNDER_REVIEW";
export type MaterialProblem = "MISSING" | "DAMAGED" | "INADEQUATE";

export type RawPostDay = {
  postId: string;
  date: string;
  postOperating: boolean;
  scheduled: { userId: string; name: string }[];
  journeys: {
    userId: string;
    name: string;
    records: {
      kind: "CHECK_IN" | "CHECK_OUT";
      primary: boolean;
      status: RecordStatus;
    }[];
    checklist: {
      status: "DRAFT" | "SUBMITTED";
      problems: { label: string; state: MaterialProblem }[];
    } | null;
  }[];
  occurrences: { category: string; annulled: boolean }[];
  alerts: {
    status: "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS" | "CLOSED" | "CANCELLED";
  }[];
  changes: number;
};

export type Warning = "NO_SCHEDULE" | "ABSENT" | "WITHOUT_EXIT" | "UNSCHEDULED";

export type DaySummary = {
  schema: typeof SUMMARY_SCHEMA;
  staffing: {
    scheduled: number;
    present: number;
    absent: number;
    unscheduled: number;
  };
  presence: {
    validated: number;
    provisional: number;
    rejected: number;
    withoutExit: number;
    pendingRecords: number;
  };
  checklists: {
    submitted: number;
    incomplete: number;
    notStarted: number;
    problems: number;
    problemItems: { label: string; state: MaterialProblem; person: string }[];
  };
  occurrences: {
    total: number;
    annulled: number;
    byCategory: { name: string; count: number }[];
  };
  alerts: {
    created: number;
    active: number;
    closed: number;
    cancelled: number;
  };
  changes: number;
  pending: {
    presence: number;
    checklists: number;
    alerts: number;
    total: number;
  };
  warnings: Warning[];
};

export type PostDaySummary = DaySummary & { postId: string; date: string };

const PENDING_STATUSES: readonly RecordStatus[] = [
  "AWAITING_VALIDATION",
  "UNDER_REVIEW",
];
const ACTIVE_ALERTS = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"];

export function summarizePostDay(raw: RawPostDay): PostDaySummary {
  const scheduledIds = new Set(raw.scheduled.map((entry) => entry.userId));
  const presentIds = new Set(raw.journeys.map((journey) => journey.userId));

  const presence = {
    validated: 0,
    provisional: 0,
    rejected: 0,
    withoutExit: 0,
    pendingRecords: 0,
  };
  const checklists = {
    submitted: 0,
    incomplete: 0,
    notStarted: 0,
    problems: 0,
    problemItems: [] as DaySummary["checklists"]["problemItems"],
  };

  for (const journey of raw.journeys) {
    const entry = journey.records.find(
      (record) => record.primary && record.kind === "CHECK_IN",
    );
    const exit = journey.records.find(
      (record) => record.primary && record.kind === "CHECK_OUT",
    );
    if (entry?.status === "VALIDATED") presence.validated++;
    else if (entry?.status === "REJECTED") presence.rejected++;
    else if (entry) presence.provisional++;
    if (entry && !exit) presence.withoutExit++;
    presence.pendingRecords += journey.records.filter((record) =>
      PENDING_STATUSES.includes(record.status),
    ).length;

    if (!journey.checklist) checklists.notStarted++;
    else if (journey.checklist.status === "DRAFT") checklists.incomplete++;
    else {
      checklists.submitted++;
      for (const problem of journey.checklist.problems) {
        checklists.problemItems.push({ ...problem, person: journey.name });
      }
    }
  }
  checklists.problems = checklists.problemItems.length;

  const byCategory = new Map<string, number>();
  let annulled = 0;
  for (const occurrence of raw.occurrences) {
    if (occurrence.annulled) annulled++;
    else
      byCategory.set(
        occurrence.category,
        (byCategory.get(occurrence.category) ?? 0) + 1,
      );
  }

  const alerts = {
    created: raw.alerts.length,
    active: raw.alerts.filter((alert) => ACTIVE_ALERTS.includes(alert.status))
      .length,
    closed: raw.alerts.filter((alert) => alert.status === "CLOSED").length,
    cancelled: raw.alerts.filter((alert) => alert.status === "CANCELLED")
      .length,
  };

  const staffing = {
    scheduled: scheduledIds.size,
    present: presentIds.size,
    absent: [...scheduledIds].filter((id) => !presentIds.has(id)).length,
    unscheduled: [...presentIds].filter((id) => !scheduledIds.has(id)).length,
  };

  const pending = {
    presence: presence.pendingRecords,
    checklists: checklists.incomplete + checklists.notStarted,
    alerts: alerts.active,
    total: 0,
  };
  pending.total = pending.presence + pending.checklists + pending.alerts;

  const warnings: Warning[] = [];
  if (raw.postOperating && staffing.scheduled === 0)
    warnings.push("NO_SCHEDULE");
  if (staffing.absent > 0) warnings.push("ABSENT");
  if (presence.withoutExit > 0) warnings.push("WITHOUT_EXIT");
  if (staffing.unscheduled > 0) warnings.push("UNSCHEDULED");

  return {
    schema: SUMMARY_SCHEMA,
    postId: raw.postId,
    date: raw.date,
    staffing,
    presence,
    checklists,
    occurrences: {
      total: [...byCategory.values()].reduce((sum, count) => sum + count, 0),
      annulled,
      byCategory: [...byCategory.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },
    alerts,
    changes: raw.changes,
    pending,
    warnings,
  };
}

/** The part of a post-day summary that a closing version freezes. */
export function toDaySummary(summary: DaySummary): DaySummary {
  return {
    schema: summary.schema,
    staffing: summary.staffing,
    presence: summary.presence,
    checklists: summary.checklists,
    occurrences: summary.occurrences,
    alerts: summary.alerts,
    changes: summary.changes,
    pending: summary.pending,
    warnings: summary.warnings,
  };
}

/** Totals over several post-days: plain sums of the same fields. */
export function sumSummaries(summaries: readonly DaySummary[]): DaySummary {
  const total: DaySummary = {
    schema: SUMMARY_SCHEMA,
    staffing: { scheduled: 0, present: 0, absent: 0, unscheduled: 0 },
    presence: {
      validated: 0,
      provisional: 0,
      rejected: 0,
      withoutExit: 0,
      pendingRecords: 0,
    },
    checklists: {
      submitted: 0,
      incomplete: 0,
      notStarted: 0,
      problems: 0,
      problemItems: [],
    },
    occurrences: { total: 0, annulled: 0, byCategory: [] },
    alerts: { created: 0, active: 0, closed: 0, cancelled: 0 },
    changes: 0,
    pending: { presence: 0, checklists: 0, alerts: 0, total: 0 },
    warnings: [],
  };
  const categories = new Map<string, number>();
  const add = <T extends Record<string, number>>(into: T, from: T) => {
    for (const key of Object.keys(into) as (keyof T)[]) {
      into[key] = ((into[key] as number) + (from[key] as number)) as T[keyof T];
    }
  };
  for (const summary of summaries) {
    add(total.staffing, summary.staffing);
    add(total.presence, summary.presence);
    add(total.alerts, summary.alerts);
    add(total.pending, summary.pending);
    total.checklists.submitted += summary.checklists.submitted;
    total.checklists.incomplete += summary.checklists.incomplete;
    total.checklists.notStarted += summary.checklists.notStarted;
    total.checklists.problems += summary.checklists.problems;
    total.checklists.problemItems.push(...summary.checklists.problemItems);
    total.occurrences.total += summary.occurrences.total;
    total.occurrences.annulled += summary.occurrences.annulled;
    for (const { name, count } of summary.occurrences.byCategory) {
      categories.set(name, (categories.get(name) ?? 0) + count);
    }
    total.changes += summary.changes;
    for (const warning of summary.warnings) {
      if (!total.warnings.includes(warning)) total.warnings.push(warning);
    }
  }
  total.occurrences.byCategory = [...categories.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return total;
}

export const WARNING_LABELS: Record<Warning, string> = {
  NO_SCHEDULE: "Posto em operação sem escala confirmada",
  ABSENT: "Escalado sem entrada registrada",
  WITHOUT_EXIT: "Entrada sem saída registrada",
  UNSCHEDULED: "Entrada de quem não estava escalado",
};

export const MATERIAL_LABELS: Record<MaterialProblem, string> = {
  MISSING: "Ausente",
  DAMAGED: "Danificado",
  INADEQUATE: "Inadequado",
};
