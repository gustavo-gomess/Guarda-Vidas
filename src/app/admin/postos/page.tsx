import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  createPostAction,
  setPostActiveAction,
} from "@/features/posts/actions";
import { listVisiblePosts } from "@/features/posts/queries";
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
        <ul className="flex flex-col gap-2">
          {posts.map((post) => (
            <li key={post.id} className="flex flex-wrap items-center gap-3">
              <Link href={`/postos/${post.id}`} className="underline">
                {post.name}
              </Link>
              <span className="text-sm text-zinc-500">
                {post.active ? "Ativo" : "Inativo"}
              </span>
              <ActionForm
                action={setPostActiveAction}
                submitLabel={post.active ? "Desativar" : "Reativar"}
                compact
              >
                <input type="hidden" name="postId" value={post.id} />
                <input
                  type="hidden"
                  name="active"
                  value={post.active ? "false" : "true"}
                />
              </ActionForm>
            </li>
          ))}
          {posts.length === 0 ? (
            <li className="text-zinc-600 dark:text-zinc-400">
              Nenhum posto cadastrado.
            </li>
          ) : null}
        </ul>
        <section className="flex max-w-sm flex-col gap-3">
          <h2 className="text-lg font-semibold">Novo posto</h2>
          <ActionForm
            action={createPostAction}
            submitLabel="Criar posto"
            successMessage="Posto criado."
            className="flex flex-col gap-4"
          >
            <Field label="Nome" name="name" required />
          </ActionForm>
        </section>
      </PageShell>
    </>
  );
}
