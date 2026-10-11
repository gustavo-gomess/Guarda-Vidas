import { ActionForm } from "@/components/ui/action-form";
import { decideAttendanceAction } from "@/features/attendance/actions";
import type { ServerStatus } from "@/features/attendance/states";

const OPTIONS: {
  value: Exclude<ServerStatus, "AWAITING_VALIDATION">;
  label: string;
}[] = [
  { value: "VALIDATED", label: "Validar" },
  { value: "REJECTED", label: "Rejeitar" },
  { value: "UNDER_REVIEW", label: "Manter em análise" },
];

/** Coordinator decision. The server checks permission and justification. */
export function DecisionForm({
  recordId,
  status,
}: {
  recordId: string;
  status: ServerStatus;
}) {
  const options = OPTIONS.filter((option) => option.value !== status);
  return (
    <ActionForm
      action={decideAttendanceAction}
      submitLabel="Registrar decisão"
      successMessage="Decisão registrada."
      compact
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <input type="hidden" name="recordId" value={recordId} />
      <label className="flex flex-col gap-1">
        <span className="font-medium">Decisão</span>
        <select
          name="decision"
          className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-60 flex-1 flex-col gap-1">
        <span className="font-medium">
          Justificativa (obrigatória para rejeitar, manter em análise ou rever
          decisão)
        </span>
        <input
          name="reason"
          maxLength={500}
          className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
    </ActionForm>
  );
}
