import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { CreateUserForm } from "@/features/users/components/temporary-password-forms";
import { listUsersForAdmin } from "@/features/users/queries";
import { ROLE_LABELS } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";

export default function UsersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const actor = await requireActor();
  const users = await listUsersForAdmin(actor);
  if (!users) notFound();

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Usuários">
        <section className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-3">Nome</th>
                <th className="py-2 pr-3">Usuário</th>
                <th className="py-2 pr-3">Perfil</th>
                <th className="py-2 pr-3">Situação</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-zinc-100 dark:border-zinc-900"
                >
                  <td className="py-2 pr-3">
                    <Link
                      href={`/admin/usuarios/${user.id}`}
                      className="underline"
                    >
                      {user.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 font-mono">{user.username}</td>
                  <td className="py-2 pr-3">
                    {ROLE_LABELS[user.role]}
                    {user.isAdmin ? " · admin" : ""}
                  </td>
                  <td className="py-2 pr-3">
                    {user.active ? "Ativo" : "Inativo"}
                    {user.active && user.mustChangePassword
                      ? " · senha temporária"
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="flex max-w-sm flex-col gap-3">
          <h2 className="text-lg font-semibold">Novo usuário</h2>
          <CreateUserForm />
        </section>
      </PageShell>
    </>
  );
}
