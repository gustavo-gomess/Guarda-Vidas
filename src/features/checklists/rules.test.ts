import { describe, expect, it } from "vitest";

import {
  diffSnapshots,
  itemChanged,
  planSave,
  progressOf,
  snapshotLines,
  type SaveContext,
  type SaveInput,
} from "@/features/checklists/rules";

const ANA = "ana";
const LINES = ["l1", "l2"];

function input(overrides: Partial<SaveInput> = {}): SaveInput {
  return {
    requestId: "req-1",
    answers: [
      { lineId: "l1", state: "OK", note: "" },
      { lineId: "l2", state: "DAMAGED", note: "Rasgado" },
    ],
    generalNote: "",
    submit: false,
    reason: "",
    ...overrides,
  };
}

function context(overrides: Partial<SaveContext> = {}): SaveContext {
  return {
    actorId: ANA,
    checklist: { userId: ANA, status: "DRAFT", lineIds: LINES },
    existingRevision: null,
    latest: null,
    nextNumber: 1,
    ...overrides,
  };
}

describe("progress", () => {
  it("separates pending, incomplete and sent", () => {
    expect(progressOf(null)).toBe("PENDING");
    expect(progressOf({ status: "DRAFT" })).toBe("INCOMPLETE");
    expect(progressOf({ status: "SUBMITTED" })).toBe("SUBMITTED");
  });
});

describe("item list and versions", () => {
  const base = { label: "Boia", guidance: "", position: 1, active: true };

  it("detects real changes only", () => {
    expect(itemChanged(base, { ...base })).toBe(false);
    expect(itemChanged(base, { ...base, label: "Boia circular" })).toBe(true);
    expect(itemChanged(base, { ...base, active: false })).toBe(true);
    expect(itemChanged(base, { ...base, position: 2 })).toBe(true);
  });

  it("freezes the active items, in order, for a new checklist", () => {
    const lines = snapshotLines([
      { ...base, itemId: "i2", versionId: "v2", label: "Rádio", position: 2 },
      { ...base, itemId: "i1", versionId: "v1", label: "Boia", position: 1 },
      { ...base, itemId: "i3", versionId: "v3", label: "Velho", active: false },
    ]);
    expect(lines).toEqual([
      {
        itemId: "i1",
        itemVersionId: "v1",
        position: 1,
        label: "Boia",
        guidance: "",
      },
      {
        itemId: "i2",
        itemVersionId: "v2",
        position: 2,
        label: "Rádio",
        guidance: "",
      },
    ]);
  });
});

describe("creating and sending", () => {
  it("saves a draft as the first revision", () => {
    expect(planSave(input(), context())).toMatchObject({
      type: "create",
      kind: "DRAFT",
      number: 1,
      submits: false,
    });
  });

  it("allows an incomplete draft but not an incomplete submission", () => {
    const partial = input({
      answers: [{ lineId: "l1", state: "OK", note: "" }],
    });
    const draft = planSave(partial, context());
    expect(draft).toMatchObject({ type: "create", kind: "DRAFT" });
    expect(draft.type === "create" && draft.answers).toEqual([
      { lineId: "l1", state: "OK", note: "" },
      { lineId: "l2", state: null, note: "" },
    ]);
    expect(planSave({ ...partial, submit: true }, context())).toEqual({
      type: "error",
      message: "Faltam 1 item(ns) para enviar. Você pode salvar como rascunho.",
    });
  });

  it("sends a complete checklist", () => {
    expect(
      planSave(input({ submit: true }), context({ nextNumber: 3 })),
    ).toMatchObject({
      type: "create",
      kind: "SUBMISSION",
      number: 3,
      submits: true,
    });
  });

  it("does not store a draft identical to the last one", () => {
    expect(
      planSave(
        input(),
        context({ latest: { answers: input().answers, generalNote: "" } }),
      ),
    ).toEqual({ type: "unchanged" });
  });

  it("trims notes and ignores order of answers", () => {
    const plan = planSave(
      input({
        answers: [
          { lineId: "l2", state: "OK", note: "  ok  " },
          { lineId: "l1", state: "OK", note: "" },
        ],
      }),
      context(),
    );
    expect(plan.type === "create" && plan.answers).toEqual([
      { lineId: "l1", state: "OK", note: "" },
      { lineId: "l2", state: "OK", note: "ok" },
    ]);
  });
});

describe("duplicates and lost connections", () => {
  it("recognizes a repeated request (same id) and stores nothing", () => {
    expect(
      planSave(
        input({ submit: true }),
        context({
          existingRevision: { checklistId: "c1", matchesThisChecklist: true },
        }),
      ),
    ).toEqual({ type: "already-saved" });
  });

  it("refuses a request id used by another checklist", () => {
    expect(
      planSave(
        input(),
        context({
          existingRevision: { checklistId: "c2", matchesThisChecklist: false },
        }),
      ),
    ).toMatchObject({ type: "error" });
  });

  it("a second submission after a lost answer becomes a correction, never a silent overwrite", () => {
    const sent = context({
      checklist: { userId: ANA, status: "SUBMITTED", lineIds: LINES },
      latest: { answers: input().answers, generalNote: "" },
      nextNumber: 2,
    });
    expect(planSave(input({ requestId: "req-2", submit: true }), sent)).toEqual(
      {
        type: "error",
        message: "Nada foi alterado.",
      },
    );
  });
});

describe("corrections", () => {
  const sent = context({
    checklist: { userId: ANA, status: "SUBMITTED", lineIds: LINES },
    latest: { answers: input().answers, generalNote: "" },
    nextNumber: 2,
  });
  const changed = input({
    answers: [
      { lineId: "l1", state: "MISSING", note: "Levado para manutenção" },
      { lineId: "l2", state: "DAMAGED", note: "Rasgado" },
    ],
  });

  it("require a reason", () => {
    expect(planSave(changed, sent)).toMatchObject({
      type: "error",
      message: expect.stringMatching(/motivo da correção/),
    });
  });

  it("create a new revision with the reason; the old one stays", () => {
    expect(
      planSave({ ...changed, reason: "Marquei errado" }, sent),
    ).toMatchObject({
      type: "create",
      kind: "CORRECTION",
      number: 2,
      submits: false,
    });
  });

  it("cannot leave items unanswered", () => {
    expect(
      planSave(
        {
          ...changed,
          reason: "Correção",
          answers: [{ lineId: "l1", state: null, note: "" }],
        },
        sent,
      ),
    ).toMatchObject({ type: "error", message: "Responda todos os itens." });
  });
});

describe("permissions and integrity", () => {
  it("only the person of the assumption fills it", () => {
    expect(planSave(input(), context({ actorId: "bia" }))).toEqual({
      type: "error",
      message: "Este checklist é de outra pessoa.",
    });
  });

  it("refuses answers to lines that are not in this checklist", () => {
    expect(
      planSave(
        input({
          answers: [{ lineId: "other-checklist-line", state: "OK", note: "" }],
        }),
        context(),
      ),
    ).toMatchObject({ type: "error" });
  });
});

describe("history", () => {
  it("lists what changed between revisions", () => {
    const first = { answers: input().answers, generalNote: "" };
    const second = {
      answers: [
        { lineId: "l1", state: "OK" as const, note: "" },
        { lineId: "l2", state: "OK" as const, note: "Trocado" },
      ],
      generalNote: "Mar agitado",
    };
    expect(diffSnapshots(first, second)).toEqual({
      changes: [
        {
          lineId: "l2",
          before: { state: "DAMAGED", note: "Rasgado" },
          after: { state: "OK", note: "Trocado" },
        },
      ],
      generalNoteChanged: true,
    });
    expect(diffSnapshots(null, first).changes).toHaveLength(2);
  });
});
