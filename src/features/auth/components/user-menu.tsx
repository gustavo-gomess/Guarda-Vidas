import Link from "next/link";

import { logoutAction } from "@/features/auth/actions";
import { ROLE_LABELS, type Actor } from "@/lib/auth/policy";

export function UserMenu({ actor }: { actor: Actor }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <nav className="flex flex-wrap items-center gap-4 text-sm">
        <Link href="/" className="font-semibold">
          Guarda-Vidas
        </Link>
        <Link href="/escalas" className="underline">
          Escalas
        </Link>
        <Link href="/presenca" className="underline">
          Presença
        </Link>
        <Link href="/checklists" className="underline">
          Checklist
        </Link>
        <Link href="/disponibilidade" className="underline">
          Disponibilidade
        </Link>
        {actor.isAdmin ? (
          <>
            <Link href="/admin/usuarios" className="underline">
              Usuários
            </Link>
            <Link href="/admin/postos" className="underline">
              Postos
            </Link>
          </>
        ) : null}
      </nav>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {actor.name} · {ROLE_LABELS[actor.role]}
          {actor.isAdmin ? " · Administrador" : ""}
        </span>
        <Link href="/conta/senha" className="underline">
          Alterar senha
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="underline">
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
