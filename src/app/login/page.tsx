import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Entrar — Guarda-Vidas" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Guarda-Vidas</h1>
      <LoginForm />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Esqueceu a senha? Procure um administrador do sistema.
      </p>
    </main>
  );
}
