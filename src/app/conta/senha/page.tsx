import { Suspense } from "react";

import { Loading, PageShell } from "@/components/ui/page-shell";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { UserMenu } from "@/features/auth/components/user-menu";
import { requireActor } from "@/lib/auth/session";

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const actor = await requireActor({ allowPendingPasswordChange: true });
  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Alterar senha">
        {actor.mustChangePassword ? (
          <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            Você está usando uma senha temporária. Escolha uma nova senha para
            continuar.
          </p>
        ) : null}
        <div className="max-w-sm">
          <ChangePasswordForm />
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ao alterar a senha, as sessões abertas em outros aparelhos são
          encerradas.
        </p>
      </PageShell>
    </>
  );
}
