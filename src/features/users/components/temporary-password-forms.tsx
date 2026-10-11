"use client";

import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import {
  createUserAction,
  resetPasswordAction,
} from "@/features/users/actions";

function TemporaryPassword({ password }: { password: string }) {
  return (
    <div
      role="status"
      className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">Senha temporária (mostrada só agora):</p>
      <p className="my-2 font-mono text-lg tracking-wider select-all">
        {password}
      </p>
      <p>
        Entregue pessoalmente ao usuário. Ela não fica salva e terá de ser
        trocada no primeiro acesso.
      </p>
    </div>
  );
}

export function CreateUserForm() {
  return (
    <ActionForm
      action={createUserAction}
      submitLabel="Criar usuário"
      className="flex flex-col gap-4"
      renderSuccess={(data) => (
        <TemporaryPassword password={data.temporaryPassword} />
      )}
    >
      <Field
        label="Usuário (login)"
        name="username"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <Field label="Nome" name="name" required />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Perfil</span>
        <select
          name="role"
          required
          defaultValue="LIFEGUARD"
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="LIFEGUARD">Guarda-vidas</option>
          <option value="COORDINATOR">Coordenador</option>
          <option value="AUTHORITY">Autoridade superior</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isAdmin" />
        Administrador (não permitido para guarda-vidas)
      </label>
    </ActionForm>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  return (
    <ActionForm
      action={resetPasswordAction}
      submitLabel="Gerar nova senha temporária"
      pendingLabel="Gerando…"
      renderSuccess={(data) => (
        <TemporaryPassword password={data.temporaryPassword} />
      )}
    >
      <input type="hidden" name="userId" value={userId} />
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
        Encerra todas as sessões do usuário e exige a troca da senha no próximo
        acesso.
      </p>
    </ActionForm>
  );
}
