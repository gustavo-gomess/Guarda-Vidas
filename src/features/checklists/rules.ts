/**
 * Checklist rules, free of Next.js and the database.
 *
 * Approved: one checklist per assumption, per lifeguard; the item list is
 * configurable; changes to the list never alter old records; corrections
 * never erase what was recorded.
 * Provisional (docs/OPEN-DECISIONS.md, OD-06, OD-32 to OD-35): the item
 * states, who edits the list, who corrects, and that the checklist works
 * online only (offline is not approved).
 */

export type ItemState = "OK" | "MISSING" | "DAMAGED" | "INADEQUATE";
export type ChecklistStatus = "DRAFT" | "SUBMITTED";
export type RevisionKind = "DRAFT" | "SUBMISSION" | "CORRECTION";
/** As shown to people: PENDING means no checklist was started yet. */
export type ChecklistProgress = "PENDING" | "INCOMPLETE" | "SUBMITTED";

export const ITEM_STATES: readonly ItemState[] = [
  "OK",
  "MISSING",
  "DAMAGED",
  "INADEQUATE",
];

export const ITEM_STATE_LABELS: Record<ItemState, string> = {
  OK: "Em condições",
  MISSING: "Ausente",
  DAMAGED: "Danificado",
  INADEQUATE: "Inadequado",
};

/** States that are a material problem for the coordination. */
export const PROBLEM_STATES: readonly ItemState[] = [
  "MISSING",
  "DAMAGED",
  "INADEQUATE",
];

export const PROGRESS_LABELS: Record<ChecklistProgress, string> = {
  PENDING: "Pendente (não iniciado)",
  INCOMPLETE: "Incompleto (não enviado)",
  SUBMITTED: "Enviado",
};

export const REVISION_LABELS: Record<RevisionKind, string> = {
  DRAFT: "Rascunho salvo",
  SUBMISSION: "Enviado",
  CORRECTION: "Correção",
};

export const MIN_REASON_LENGTH = 5;

export function progressOf(
  checklist: { status: ChecklistStatus } | null,
): ChecklistProgress {
  if (!checklist) return "PENDING";
  return checklist.status === "SUBMITTED" ? "SUBMITTED" : "INCOMPLETE";
}

// --- Item list ---------------------------------------------------------------

export type ItemVersion = {
  label: string;
  guidance: string;
  position: number;
  active: boolean;
};

/** True when the new content differs from the current version. */
export function itemChanged(current: ItemVersion, next: ItemVersion): boolean {
  return (
    current.label !== next.label ||
    current.guidance !== next.guidance ||
    current.position !== next.position ||
    current.active !== next.active
  );
}

/**
 * The lines of a new checklist: a frozen copy of the active items, in
 * order. Never copied from another person's checklist.
 */
export function snapshotLines<
  T extends ItemVersion & { itemId: string; versionId: string },
>(currentVersions: readonly T[]) {
  return currentVersions
    .filter((version) => version.active)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))
    .map((version, index) => ({
      itemId: version.itemId,
      itemVersionId: version.versionId,
      position: index + 1,
      label: version.label,
      guidance: version.guidance,
    }));
}

// --- Saving ------------------------------------------------------------------

export type Answer = { lineId: string; state: ItemState | null; note: string };

export type Snapshot = { answers: Answer[]; generalNote: string };

export type SaveInput = {
  requestId: string;
  answers: Answer[];
  generalNote: string;
  submit: boolean;
  reason: string;
};

export type SaveContext = {
  actorId: string;
  checklist: {
    userId: string;
    status: ChecklistStatus;
    lineIds: readonly string[];
  };
  /** A revision already stored with this request id. */
  existingRevision: {
    checklistId: string;
    matchesThisChecklist: boolean;
  } | null;
  latest: Snapshot | null;
  nextNumber: number;
};

export type SavePlan =
  | { type: "error"; message: string }
  | { type: "already-saved" }
  | { type: "unchanged" }
  | {
      type: "create";
      kind: RevisionKind;
      number: number;
      answers: Answer[];
      submits: boolean;
    };

function normalize(snapshot: Snapshot, lineIds: readonly string[]): Snapshot {
  const byLine = new Map(
    snapshot.answers.map((answer) => [answer.lineId, answer]),
  );
  return {
    generalNote: snapshot.generalNote.trim(),
    answers: lineIds.map((lineId) => ({
      lineId,
      state: byLine.get(lineId)?.state ?? null,
      note: byLine.get(lineId)?.note.trim() ?? "",
    })),
  };
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Decides what a save does. Every save stores a full new revision; nothing
 * is updated in place. The request id makes a repeated request (lost
 * answer, double click, retry after losing connection) harmless.
 */
export function planSave(input: SaveInput, ctx: SaveContext): SavePlan {
  if (ctx.existingRevision) {
    return ctx.existingRevision.matchesThisChecklist
      ? { type: "already-saved" }
      : { type: "error", message: "Identificador de envio inválido." };
  }
  // Only the person of the assumption fills or corrects their checklist.
  if (ctx.checklist.userId !== ctx.actorId) {
    return { type: "error", message: "Este checklist é de outra pessoa." };
  }

  const known = new Set(ctx.checklist.lineIds);
  if (input.answers.some((answer) => !known.has(answer.lineId))) {
    return {
      type: "error",
      message:
        "A lista mudou ou a resposta não pertence a este checklist. Recarregue a página.",
    };
  }

  const next = normalize(input, ctx.checklist.lineIds);
  const previous = ctx.latest
    ? normalize(ctx.latest, ctx.checklist.lineIds)
    : null;
  const complete = next.answers.every((answer) => answer.state !== null);

  if (ctx.checklist.status === "SUBMITTED") {
    if (previous && sameSnapshot(next, previous)) {
      return { type: "error", message: "Nada foi alterado." };
    }
    if (!complete) {
      return { type: "error", message: "Responda todos os itens." };
    }
    if (input.reason.trim().length < MIN_REASON_LENGTH) {
      return {
        type: "error",
        message: `O checklist já foi enviado. Informe o motivo da correção (mínimo de ${MIN_REASON_LENGTH} caracteres).`,
      };
    }
    return {
      type: "create",
      kind: "CORRECTION",
      number: ctx.nextNumber,
      answers: next.answers,
      submits: false,
    };
  }

  if (input.submit && !complete) {
    const missing = next.answers.filter(
      (answer) => answer.state === null,
    ).length;
    return {
      type: "error",
      message: `Faltam ${missing} item(ns) para enviar. Você pode salvar como rascunho.`,
    };
  }
  if (!input.submit && previous && sameSnapshot(next, previous)) {
    return { type: "unchanged" };
  }
  return {
    type: "create",
    kind: input.submit ? "SUBMISSION" : "DRAFT",
    number: ctx.nextNumber,
    answers: next.answers,
    submits: input.submit,
  };
}

// --- History -----------------------------------------------------------------

export type AnswerChange = {
  lineId: string;
  before: { state: ItemState | null; note: string };
  after: { state: ItemState | null; note: string };
};

/** What changed between two revisions, for the history screen. */
export function diffSnapshots(previous: Snapshot | null, next: Snapshot) {
  const before = new Map(
    previous?.answers.map((answer) => [answer.lineId, answer]),
  );
  const changes: AnswerChange[] = [];
  for (const answer of next.answers) {
    const old = before.get(answer.lineId);
    if (!old || old.state !== answer.state || old.note !== answer.note) {
      changes.push({
        lineId: answer.lineId,
        before: { state: old?.state ?? null, note: old?.note ?? "" },
        after: { state: answer.state, note: answer.note },
      });
    }
  }
  return {
    changes,
    generalNoteChanged: (previous?.generalNote ?? "") !== next.generalNote,
  };
}
