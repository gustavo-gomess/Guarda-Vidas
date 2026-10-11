import { z } from "zod";

/**
 * Result of a Server Action or other operation with expected failures.
 * Expected errors (validation, business rules) are returned, not thrown;
 * unexpected errors are thrown and reach the nearest error.tsx.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

/** Expected failure with a message that is safe to show to the user. */
export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/** True for a Prisma unique-constraint violation (error code P2002). */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/** Converts a Zod validation error into a user-facing result. */
export function invalidInput(
  error: z.ZodError,
  message = "Confira os campos destacados.",
): ActionResult<never> {
  const { fieldErrors } = z.flattenError(error);
  return {
    ok: false,
    error: message,
    fieldErrors: Object.fromEntries(
      Object.entries(fieldErrors).filter((entry): entry is [string, string[]] =>
        Array.isArray(entry[1]),
      ),
    ),
  };
}
