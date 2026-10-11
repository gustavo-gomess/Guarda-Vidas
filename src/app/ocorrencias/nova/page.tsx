import Link from "next/link";
import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { OccurrenceForm } from "@/features/occurrences/components/occurrence-form";
import { listCategories } from "@/features/occurrences/queries";
import { listVisiblePosts } from "@/features/posts/queries";
import { canRecordOccurrence } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";

export default function NewOccurrencePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const actor = await requireActor();
  const [posts, categories] = await Promise.all([
    listVisiblePosts(actor),
    listCategories(),
  ]);
  const allowed = posts.filter(
    (post) =>
      post.status === "OPERATING" && canRecordOccurrence(actor, post.id),
  );

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Novo registro operacional">
        {allowed.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Somente guarda-vidas da equipe de um posto em operação registram
            ocorrências.{" "}
            <Link href="/ocorrencias" className="underline">
              Ver registros
            </Link>
          </p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Exige internet. Sem conexão nada é registrado e os dados ficam na
              tela até você tentar de novo.
            </p>
            <OccurrenceForm
              posts={allowed}
              categories={categories.map((category) => ({
                id: category.id,
                name: category.current.name,
                description: category.current.description,
                fields: category.current.fields,
              }))}
            />
          </>
        )}
      </PageShell>
    </>
  );
}
