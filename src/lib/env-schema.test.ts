import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "@/lib/env-schema";

const VALID_URL = "postgresql://user:s3cret-value@localhost:5432/app";

function parseError(source: Record<string, string | undefined>) {
  try {
    parseServerEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error("expected parseServerEnv to throw");
}

describe("parseServerEnv", () => {
  it("accepts a valid environment and applies defaults", () => {
    expect(parseServerEnv({ DATABASE_URL: VALID_URL })).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: VALID_URL,
      LOG_LEVEL: "info",
    });
  });

  it("accepts the postgres:// scheme", () => {
    const env = parseServerEnv({ DATABASE_URL: "postgres://u:p@db:5432/app" });
    expect(env.DATABASE_URL).toBe("postgres://u:p@db:5432/app");
  });

  it("reports a missing DATABASE_URL by name", () => {
    const error = parseError({});
    expect(error.issues).toEqual([
      expect.stringMatching(/^DATABASE_URL: é obrigatória/),
    ]);
    expect(error.message).toContain("Variáveis de ambiente inválidas");
  });

  it("treats an empty value as missing", () => {
    const error = parseError({ DATABASE_URL: "" });
    expect(error.issues[0]).toMatch(/^DATABASE_URL: é obrigatória/);
  });

  it("rejects a non-PostgreSQL URL", () => {
    const error = parseError({ DATABASE_URL: "mysql://u:p@localhost/app" });
    expect(error.issues[0]).toMatch(/^DATABASE_URL: deve ser uma URL/);
  });

  it("reports every invalid variable at once", () => {
    const error = parseError({ NODE_ENV: "staging", LOG_LEVEL: "verbose" });
    expect(error.issues.map((issue) => issue.split(":")[0]).sort()).toEqual([
      "DATABASE_URL",
      "LOG_LEVEL",
      "NODE_ENV",
    ]);
  });

  it("never includes received values in the error message", () => {
    const error = parseError({
      DATABASE_URL: "mysql://user:s3cret-value@localhost/app",
      LOG_LEVEL: "s3cret-value",
    });
    expect(error.message).not.toContain("s3cret-value");
  });
});
