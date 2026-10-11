import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { Field, TextAreaField } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { createPostAction } from "@/features/posts/actions";
import { listVisiblePosts } from "@/features/posts/queries";
import { POST_STATUS_LABELS } from "@/features/posts/status";
import { canManagePosts } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";

export default function AdminPostsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const actor = await requireActor();
  if (!canManagePosts(actor)) notFound();
  const posts = await listVisiblePosts(actor);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Postos">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Dados, situação, coordenação e equipe são alterados na página de cada
          posto.
        </p>
        <ul className="flex flex-col gap-2">
          {posts.map((post) => (
            <li key={post.id} className="flex flex-wrap items-baseline gap-3">
              <Link href={`/postos/${post.id}`} className="underline">
                {post.code} · {post.name}
              </Link>
              <span className="text-sm text-zinc-500">
                {POST_STATUS_LABELS[post.status]}
                {post.location ? ` · ${post.location}` : ""}
              </span>
            </li>
          ))}
          {posts.length === 0 ? (
            <li className="text-zinc-600 dark:text-zinc-400">
              Nenhum posto cadastrado.
            </li>
          ) : null}
        </ul>
        <section className="flex max-w-md flex-col gap-3">
          <h2 className="text-lg font-semibold">Novo posto</h2>
          <ActionForm
            action={createPostAction}
            submitLabel="Criar posto"
            successMessage="Posto criado."
            className="flex flex-col gap-4"
          >
            <Field
              label="Identificador (ex.: P-01)"
              name="code"
              required
              maxLength={20}
            />
            <Field label="Nome" name="name" required maxLength={80} />
            <Field label="Localização" name="location" maxLength={200} />
            <TextAreaField
              label="Informações para o serviço"
              name="notes"
              maxLength={1000}
            />
          </ActionForm>
        </section>
      </PageShell>
    </>
  );
}
