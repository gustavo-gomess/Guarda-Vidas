import Link from "next/link";
import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { getMyPresence } from "@/features/attendance/queries";
import { AttendancePanel } from "@/features/attendance/components/attendance-panel";
import { OfflineSupport } from "@/features/attendance/components/offline-support";
import { UserMenu } from "@/features/auth/components/user-menu";
import { canViewAvailability } from "@/lib/auth/policy";
import { requireActor } from "@/lib/auth/session";
import { operationalToday } from "@/lib/dates";

export default function PresencePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const actor = await requireActor();
  const now = new Date();
  const presence = await getMyPresence(actor, operationalToday(now));

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Presença">
        {presence ? (
          <>
            <OfflineSupport path="/presenca" />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Sem internet, a entrada fica guardada neste aparelho e é enviada
              depois; ela só vale como presença após a validação do coordenador.
              A hora do aparelho e a localização são registradas como
              informação, não como prova.
            </p>
            <AttendancePanel
              userId={actor.id}
              renderedAt={now.toISOString()}
              posts={presence.posts}
              schedule={presence.schedule}
              journeys={presence.journeys}
            />
          </>
        ) : (
          <ul className="flex flex-col gap-2">
            {canViewAvailability(actor) ? (
              <>
                <li>
                  <Link href="/presenca/painel" className="underline">
                    Painel de presença
                  </Link>
                </li>
                <li>
                  <Link href="/presenca/validacao" className="underline">
                    Registros aguardando decisão
                  </Link>
                </li>
              </>
            ) : (
              <li>Seu perfil não registra presença.</li>
            )}
          </ul>
        )}
      </PageShell>
    </>
  );
}
