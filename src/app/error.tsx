"use client"; // Error boundaries must be Client Components.

type ErrorPageProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  // Details are logged on the server (src/instrumentation.ts). The digest
  // lets support match this screen to the server log.
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Algo deu errado</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Não foi possível concluir a operação. Tente novamente.
      </p>
      {error.digest ? (
        <p className="text-sm text-zinc-500">Código: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-md bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Tentar novamente
      </button>
    </main>
  );
}
