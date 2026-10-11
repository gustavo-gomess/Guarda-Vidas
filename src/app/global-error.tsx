"use client"; // Error boundaries must be Client Components.

type GlobalErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

// Replaces the root layout when it fails, so it renders its own document and
// does not get global styles.
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <title>Erro — Guarda-Vidas</title>
        <h1>Algo deu errado</h1>
        <p>O sistema encontrou um erro inesperado. Tente novamente.</p>
        {error.digest ? <p>Código: {error.digest}</p> : null}
        <button type="button" onClick={() => retry()}>
          Tentar novamente
        </button>
      </body>
    </html>
  );
}
