import Link from "next/link";
import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { AlertForm } from "@/features/alerts/components/alert-form";
import { listAlertPosts } from "@/features/alerts/queries";
import { NOT_SENT_GUIDANCE } from "@/features/alerts/rules";
import { OfflineSupport } from "@/features/attendance/components/offline-support";
import { UserMenu } from "@/features/auth/components/user-menu";
import { requireActor } from "@/lib/auth/session";

export default function NewAlertPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const actor = await requireActor();
  const posts = await listAlertPosts(actor);

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Alerta de reforço">
        {posts.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Somente o capitão do posto envia alerta de reforço pelo sistema. Em
            emergência, use o canal oficial.{" "}
            <Link href="/alertas" className="underline">
              Ver alertas
            </Link>
          </p>
        ) : (
          <>
            {/* Opens without internet, so the screen can say clearly that
                nothing was sent and point to the official channel. */}
            <OfflineSupport path="/alertas/novo" />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              O alerta só vale como enviado quando aparece a confirmação do
              servidor. Sem ela: {NOT_SENT_GUIDANCE}
            </p>
            <AlertForm posts={posts} />
            <Link href="/alertas" className="text-sm underline">
              Alertas do meu posto
            </Link>
          </>
        )}
      </PageShell>
    </>
  );
}
