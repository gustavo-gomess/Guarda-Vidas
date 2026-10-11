import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  createItemAction,
  setItemActiveAction,
  updateItemAction,
} from "@/features/checklists/actions";
import { getPostItems } from "@/features/checklists/queries";
import { getPostForActor } from "@/features/posts/queries";
import { postIdSchema } from "@/features/posts/schemas";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";

export default function PostItemsPage(
  props: PageProps<"/postos/[postId]/itens">,
) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<"/postos/[postId]/itens">) {
  const actor = await requireActor();
  const parsedId = postIdSchema.safeParse((await params).postId);
  if (!parsedId.success) notFound();
  const [post, list] = await Promise.all([
    getPostForActor(actor, parsedId.data),
    getPostItems(actor, parsedId.data),
  ]);
  if (!post || !list) notFound();
  const nextPosition =
    Math.max(0, ...list.items.map((item) => item.current.position)) + 1;

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={`Itens do checklist · ${post.code} · ${post.name}`}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cada alteração cria uma nova versão do item. Checklists já iniciados
          guardam a versão da época e não mudam.{" "}
          <Link href={`/postos/${post.id}`} className="underline">
            Voltar ao posto
          </Link>
        </p>

        {list.items.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhum item cadastrado. Sem itens, os guarda-vidas não conseguem
            preencher o checklist deste posto.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {list.items.map(({ id, current, versions }) => (
              <li
                key={id}
                className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p>
                  <span className="font-medium">
                    {current.position}. {current.label}
                  </span>
                  {current.active ? "" : " (desativado)"}
                  {current.guidance ? (
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      {" "}
                      · {current.guidance}
                    </span>
                  ) : null}
                </p>
                {list.canManage ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <ActionForm
                      action={updateItemAction}
                      submitLabel="Salvar nova versão"
                      compact
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="itemId" value={id} />
                      <Field
                        label="Item"
                        name="label"
                        defaultValue={current.label}
                        required
                        maxLength={120}
                      />
                      <Field
                        label="Orientação"
                        name="guidance"
                        defaultValue={current.guidance}
                        maxLength={300}
                      />
                      <Field
                        label="Ordem"
                        name="position"
                        type="number"
                        min={1}
                        max={999}
                        defaultValue={current.position}
                        className="w-20"
                      />
                    </ActionForm>
                    <ActionForm
                      action={setItemActiveAction}
                      submitLabel={current.active ? "Desativar" : "Reativar"}
                      compact
                    >
                      <input type="hidden" name="itemId" value={id} />
                      <input
                        type="hidden"
                        name="active"
                        value={current.active ? "false" : "true"}
                      />
                    </ActionForm>
                  </div>
                ) : null}
                {versions.length > 1 ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer underline">
                      {versions.length} versões
                    </summary>
                    <ol className="mt-1 flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">
                      {versions.map((version) => (
                        <li key={version.id}>
                          v{version.version} ·{" "}
                          {formatDateTime(version.createdAt)} ·{" "}
                          {version.createdBy.name} · {version.position}.{" "}
                          {version.label}
                          {version.guidance ? ` (${version.guidance})` : ""}
                          {version.active ? "" : " · desativado"}
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        {list.canManage ? (
          <section className="flex max-w-md flex-col gap-3">
            <h2 className="text-lg font-semibold">Novo item</h2>
            <ActionForm
              action={createItemAction}
              submitLabel="Adicionar item"
              successMessage="Item adicionado."
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="postId" value={post.id} />
              <Field
                label="Item (ex.: Boia circular)"
                name="label"
                required
                maxLength={120}
              />
              <Field
                label="Orientação (opcional)"
                name="guidance"
                maxLength={300}
              />
              <Field
                label="Ordem"
                name="position"
                type="number"
                min={1}
                max={999}
                defaultValue={nextPosition}
              />
            </ActionForm>
          </section>
        ) : null}
      </PageShell>
    </>
  );
}
