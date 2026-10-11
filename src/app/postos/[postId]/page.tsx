import Link from "next/link";
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
  setPostStatusAction,
  updatePostAction,
} from "@/features/posts/actions";
import {
  getPostForActor,
  listAssignableUsers,
  listPostAuditForActor,
} from "@/features/posts/queries";
import { postIdSchema } from "@/features/posts/schemas";
import {
  POST_STATUS_LABELS,
  POST_STATUS_OPTIONS,
} from "@/features/posts/status";
import { AuditList } from "@/components/ui/audit-list";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
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
      <PageShell title={`${post.code} · ${post.name}`}>
        <section className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">Situação</dt>
            <dd>{POST_STATUS_LABELS[post.status]}</dd>
            <dt className="font-medium">Localização</dt>
            <dd>{post.location || "Não informada"}</dd>
            <dt className="font-medium">Informações</dt>
            <dd className="whitespace-pre-line">{post.notes || "Nenhuma"}</dd>
            <dt className="font-medium">Proximidade</dt>
            <dd>
              {post.latitude !== null &&
              post.longitude !== null &&
              post.proximityRadiusMeters !== null
                ? `${post.proximityRadiusMeters} m de ${post.latitude}, ${post.longitude}`
                : "Não avaliada (sem coordenadas ou raio aprovado)"}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href={`/escalas?posto=${post.id}`} className="underline">
              Escalas deste posto
            </Link>
            <Link href={`/postos/${post.id}/itens`} className="underline">
              Itens do checklist
            </Link>
            <Link
              href={`/checklists/problemas?posto=${post.id}`}
              className="underline"
            >
              Problemas de materiais
            </Link>
          </div>
          {post.canChangeStatus ? (
            <ActionForm
              action={setPostStatusAction}
              submitLabel="Alterar situação"
              successMessage="Situação alterada."
              compact
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="postId" value={post.id} />
              <SelectField
                label="Situação operacional"
                name="status"
                defaultValue={post.status}
                options={POST_STATUS_OPTIONS}
              />
            </ActionForm>
          ) : null}
          {post.canEditPost ? (
            <details className="max-w-md">
              <summary className="cursor-pointer text-sm underline">
                Editar dados do posto
              </summary>
              <ActionForm
                action={updatePostAction}
                submitLabel="Salvar dados"
                successMessage="Dados salvos."
                className="mt-3 flex flex-col gap-4"
              >
                <input type="hidden" name="postId" value={post.id} />
                <Field
                  label="Identificador"
                  name="code"
                  defaultValue={post.code}
                  required
                  maxLength={20}
                />
                <Field
                  label="Nome"
                  name="name"
                  defaultValue={post.name}
                  required
                  maxLength={80}
                />
                <Field
                  label="Localização"
                  name="location"
                  defaultValue={post.location}
                  maxLength={200}
                />
                <TextAreaField
                  label="Informações para o serviço"
                  name="notes"
                  defaultValue={post.notes}
                  maxLength={1000}
                />
                <Field
                  label="Latitude (opcional, ex.: -27.59)"
                  name="latitude"
                  inputMode="decimal"
                  defaultValue={post.latitude ?? ""}
                />
                <Field
                  label="Longitude (opcional, ex.: -48.54)"
                  name="longitude"
                  inputMode="decimal"
                  defaultValue={post.longitude ?? ""}
                />
                <Field
                  label="Raio de proximidade em metros (somente valor aprovado)"
                  name="proximityRadiusMeters"
                  inputMode="numeric"
                  defaultValue={post.proximityRadiusMeters ?? ""}
                />
              </ActionForm>
            </details>
          ) : null}
        </section>

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
          post.status !== "INACTIVE" &&
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
