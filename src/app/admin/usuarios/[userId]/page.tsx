import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { AuditList } from "@/components/ui/audit-list";
import { Field } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { updateUserAction } from "@/features/users/actions";
import { ResetPasswordForm } from "@/features/users/components/temporary-password-forms";
import {
  getUserForActor,
  listUserAuditForAdmin,
} from "@/features/users/queries";
import { userIdSchema } from "@/features/users/schemas";
import { canManageUsers, ROLE_LABELS } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";

export default function UserPage({
  params,
}: PageProps<"/admin/usuarios/[userId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireActor();
  if (!canManageUsers(actor)) notFound();

  const parsedId = userIdSchema.safeParse((await params).userId);
  if (!parsedId.success) notFound();
  const user = await getUserForActor(actor, parsedId.data);
  if (!user) notFound();
  const audit = (await listUserAuditForAdmin(actor, user.id)) ?? [];
  const isSelf = user.id === actor.id;

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={user.name}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Usuário <span className="font-mono">{user.username}</span> ·{" "}
          {ROLE_LABELS[user.role]}
          {user.lockedUntil && user.lockedUntil > new Date()
            ? " · bloqueado temporariamente por tentativas de senha"
            : ""}
        </p>

        <section className="flex max-w-sm flex-col gap-3">
          <h2 className="text-lg font-semibold">Dados e acesso</h2>
          {isSelf ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Perfil, acesso de administrador e situação da sua própria conta só
              podem ser alterados por outro administrador.
            </p>
          ) : null}
          <ActionForm
            action={updateUserAction}
            submitLabel="Salvar"
            successMessage="Alterações salvas."
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="userId" value={user.id} />
            <Field label="Nome" name="name" defaultValue={user.name} required />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Perfil</span>
              <select
                name="role"
                defaultValue={user.role}
                className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="LIFEGUARD">Guarda-vidas</option>
                <option value="COORDINATOR">Coordenador</option>
                <option value="AUTHORITY">Autoridade superior</option>
              </select>
              <span className="text-zinc-500">
                Mudar o perfil remove vínculos incompatíveis (equipes ou área de
                coordenação).
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="isAdmin"
                defaultChecked={user.isAdmin}
              />
              Administrador
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                defaultChecked={user.active}
              />
              Ativo (desmarcar encerra as sessões e impede novos acessos)
            </label>
          </ActionForm>
        </section>

        {!isSelf ? (
          <section className="flex max-w-sm flex-col gap-3">
            <h2 className="text-lg font-semibold">Senha</h2>
            <ResetPasswordForm userId={user.id} />
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Vínculos</h2>
          <ul className="list-disc pl-5 text-sm">
            {user.coordinatedPosts.map(({ post }) => (
              <li key={`c-${post.id}`}>
                Coordena{" "}
                <Link href={`/postos/${post.id}`} className="underline">
                  {post.name}
                </Link>
              </li>
            ))}
            {user.assignments.map(({ post, isCaptain }) => (
              <li key={`a-${post.id}`}>
                Equipe de{" "}
                <Link href={`/postos/${post.id}`} className="underline">
                  {post.name}
                </Link>
                {isCaptain ? " (capitão)" : ""}
              </li>
            ))}
            {user.coordinatedPosts.length + user.assignments.length === 0 ? (
              <li>Nenhum vínculo. Gerencie pela página de cada posto.</li>
            ) : null}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Histórico de alterações</h2>
          <AuditList entries={audit} />
        </section>
      </PageShell>
    </>
  );
}
