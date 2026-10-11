const ACTION_LABELS: Record<string, string> = {
  "user.create": "Usuário criado",
  "user.update": "Usuário alterado",
  "user.password_reset": "Senha redefinida pelo administrador",
  "post.create": "Posto criado",
  "post.update": "Posto alterado",
  "post.coordinator_add": "Coordenador adicionado",
  "post.coordinator_remove": "Coordenador removido",
  "post.assignment_add": "Guarda-vidas adicionado",
  "post.assignment_remove": "Guarda-vidas removido",
  "post.captain_set": "Capitão definido",
  "post.captain_unset": "Capitão retirado",
  "availability_window.open": "Janela de disponibilidade aberta",
  "availability_window.close": "Janela de disponibilidade encerrada",
  "availability_window.reopen": "Janela de disponibilidade reaberta",
  "availability.submit": "Disponibilidade enviada",
  "availability.update": "Disponibilidade alterada",
  "schedule.create": "Escala proposta criada",
  "schedule.entry_add": "Guarda-vidas escalado",
  "schedule.entry_remove": "Guarda-vidas retirado da escala",
  "schedule.confirm": "Escala confirmada",
};

type AuditEntryView = {
  id: string;
  createdAt: Date;
  action: string;
  before: unknown;
  after: unknown;
  reason?: string | null;
  actor: { name: string } | null;
};

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function describe(values: unknown): string {
  if (!values || typeof values !== "object") return "";
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

export function AuditList({ entries }: { entries: AuditEntryView[] }) {
  if (entries.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">Sem registros.</p>;
  }
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="border-l-2 border-zinc-300 pl-3 dark:border-zinc-700"
        >
          <p>
            <span className="font-medium">
              {ACTION_LABELS[entry.action] ?? entry.action}
            </span>{" "}
            · {dateFormat.format(entry.createdAt)} ·{" "}
            {entry.actor?.name ?? "Sistema (linha de comando)"}
          </p>
          {entry.before || entry.after ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              {entry.before ? `antes: ${describe(entry.before)}` : ""}
              {entry.before && entry.after ? " → " : ""}
              {entry.after ? `depois: ${describe(entry.after)}` : ""}
            </p>
          ) : null}
          {entry.reason ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Justificativa: {entry.reason}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
