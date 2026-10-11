"use client";

import { loginAction } from "@/features/auth/actions";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";

export function LoginForm() {
  return (
    <ActionForm
      action={loginAction}
      submitLabel="Entrar"
      pendingLabel="Entrando…"
      className="flex flex-col gap-4"
    >
      <Field
        label="Usuário"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <Field
        label="Senha"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
    </ActionForm>
  );
}
