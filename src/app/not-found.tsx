import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        O endereço acessado não existe ou foi removido.
      </p>
      <Link href="/" className="underline">
        Voltar ao início
      </Link>
    </main>
  );
}
