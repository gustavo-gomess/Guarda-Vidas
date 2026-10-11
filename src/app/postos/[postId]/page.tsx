import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  addCoordinatorAction,
  addLifeguardAction,
  removeCoordinatorAction,
  removeLifeguardAction,
  setCaptainAction,
} from "@/features/posts/actions";
import {
  getPostForActor,
  listAssignableUsers,
  listPostAuditForActor,
} from "@/features/posts/queries";
import { postIdSchema } from "@/features/posts/schemas";
import { AuditList } from "@/components/ui/audit-list";
import { requireActor } from "@/lib/auth/session";

export default function PostPage({ params }: PageProps<"/postos/[postId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

const selectClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

async function Content({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await requireActor();
  const parsedId = postIdSchema.safeParse((await params).postId);
  // Unknown and unauthorized posts look the same: no information leaks.
  if (!parsedId.success) notFound();
  const post = await getPostForActor(actor, parsedId.data);
  if (!post) notFound();

  const [candidates, audit] = await Promise.all([
    listAssignableUsers(actor, post.id),
    listPostAuditForActor(actor, post.id),
  ]);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={`Posto ${post.name}${post.active ? "" : " (inativo)"}`}>
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Coordenação</h2>
          {post.coordinators.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Nenhum coordenador.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {post.coordinators.map(({ user }) => (
                <li key={user.id} className="flex items-center gap-3">
                  {user.name}
                  {post.canManageCoordinators ? (
                    <ActionForm
                      action={removeCoordinatorAction}
                      submitLabel="Remover"
                      compact
                    >
                      <input type="hidden" name="postId" value={post.id} />
                      <input type="hidden" name="userId" value={user.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {post.canManageCoordinators &&
          candidates &&
          candidates.coordinators.length > 0 ? (
            <ActionForm
              action={addCoordinatorAction}
              submitLabel="Adicionar coordenador"
              compact
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="postId" value={post.id} />
              <select name="userId" required className={selectClass}>
                {candidates.coordinators.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </ActionForm>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Equipe</h2>
          {post.assignments.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Nenhum guarda-vidas vinculado.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {post.assignments.map(({ user, isCaptain }) => (
                <li key={user.id} className="flex flex-wrap items-center gap-3">
                  <span>
                    {user.name}
                    {isCaptain ? " · capitão" : ""}
                    {user.active ? "" : " (inativo)"}
                  </span>
                  {post.canManageTeam ? (
                    <>
                      <ActionForm
                        action={setCaptainAction}
                        submitLabel={
                          isCaptain ? "Retirar capitão" : "Tornar capitão"
                        }
                        compact
                      >
                        <input type="hidden" name="postId" value={post.id} />
                        <input type="hidden" name="userId" value={user.id} />
                        <input
                          type="hidden"
                          name="isCaptain"
                          value={isCaptain ? "false" : "true"}
                        />
                      </ActionForm>
                      <ActionForm
                        action={removeLifeguardAction}
                        submitLabel="Remover do posto"
                        compact
                      >
                        <input type="hidden" name="postId" value={post.id} />
                        <input type="hidden" name="userId" value={user.id} />
                      </ActionForm>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {post.canManageTeam &&
          post.active &&
          candidates &&
          candidates.lifeguards.length > 0 ? (
            <ActionForm
              action={addLifeguardAction}
              submitLabel="Adicionar à equipe"
              compact
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="postId" value={post.id} />
              <select name="userId" required className={selectClass}>
                {candidates.lifeguards.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </ActionForm>
          ) : null}
        </section>

        {audit ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Histórico de alterações</h2>
            <AuditList entries={audit} />
          </section>
        ) : null}
      </PageShell>
    </>
  );
}
