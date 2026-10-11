import { z } from "zod";

/**
 * Server-side environment schema. Pure (no side effects) so it can be tested.
 * Add every new variable here and document it in .env.example.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"], {
      error: "deve ser development, test ou production",
    })
    .default("development"),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: (issue) =>
      issue.input === undefined
        ? "é obrigatória (ex.: postgresql://usuario:senha@localhost:5432/banco)"
        : "deve ser uma URL postgresql:// válida",
  }),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"], {
      error: "deve ser debug, info, warn ou error",
    })
    .default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      [
        "Variáveis de ambiente inválidas:",
        ...issues.map((issue) => `  - ${issue}`),
        "Confira .env.local (veja .env.example) ou as variáveis da hospedagem.",
      ].join("\n"),
    );
    this.name = "EnvValidationError";
  }
}

/**
 * Validates an environment source. Error messages name the variable and the
 * problem but never include the received value, which may be a secret.
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  // Treat empty strings as unset so `VAR=` falls back to defaults or fails
  // as missing instead of as malformed.
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ""),
  );
  const result = serverEnvSchema.safeParse(normalized);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`,
      ),
    );
  }

  return result.data;
}
