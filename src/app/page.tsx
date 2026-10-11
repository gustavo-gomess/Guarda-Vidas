import Link from "next/link";
import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import { listVisiblePosts } from "@/features/posts/queries";
import { POST_STATUS_LABELS } from "@/features/posts/status";
import { ROLE_LABELS } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";

export default function HomePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const actor = await requireActor();
  const posts = await listVisiblePosts(actor);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title={`Olá, ${actor.name}`}>
        <p className="text-zinc-600 dark:text-zinc-400">
          Perfil: {ROLE_LABELS[actor.role]}
          {actor.captainPostIds.length > 0 ? " · Capitão de posto" : ""}
        </p>
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Postos</h2>
          {posts.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              Nenhum posto vinculado a você.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {posts.map((post) => (
                <li key={post.id}>
                  <Link href={`/postos/${post.id}`} className="underline">
                    {post.code} · {post.name}
                  </Link>
                  {post.status === "OPERATING"
                    ? ""
                    : ` (${POST_STATUS_LABELS[post.status].toLowerCase()})`}
                  {actor.captainPostIds.includes(post.id) ? " · capitão" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageShell>
    </>
  );
}
