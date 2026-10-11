"use client";

import { useActionState, type ReactNode } from "react";

import type { ActionResult } from "@/lib/errors";

type ActionFormProps<T> = {
  action: (
    previous: ActionResult<T> | null,
    formData: FormData,
  ) => Promise<ActionResult<T>>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  successMessage?: string;
  className?: string;
  /** Visually smaller button, for inline actions in tables. */
  compact?: boolean;
  /** Custom content after success, e.g. a one-time temporary password. */
  renderSuccess?: (data: T) => ReactNode;
};

/**
 * Form bound to a Server Action that returns ActionResult. Shows the general
 * error, field errors and an optional success message. Validation and
 * authorization happen in the action on the server; this is only display.
 */
export function ActionForm<T>({
  action,
  children,
  submitLabel,
  pendingLabel = "Salvando…",
  successMessage,
  className,
  compact = false,
  renderSuccess,
}: ActionFormProps<T>) {
  const [state, formAction, pending] = useActionState(action, null);

  const fieldErrors =
    state && !state.ok && state.fieldErrors
      ? Object.values(state.fieldErrors).flat()
      : [];

  return (
    <form action={formAction} className={className}>
      {children}
      <button
        type="submit"
        disabled={pending}
        className={
          compact
            ? "rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            : "rounded-md bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        }
      >
        {pending ? pendingLabel : submitLabel}
      </button>
      <div aria-live="polite">
        {state && !state.ok ? (
          <div
            role="alert"
            className="mt-2 text-sm text-red-700 dark:text-red-400"
          >
            <p>{state.error}</p>
            {fieldErrors.length > 0 ? (
              <ul className="list-disc pl-5">
                {fieldErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {state?.ok && successMessage ? (
          <p className="mt-2 text-sm text-green-700 dark:text-green-400">
            {successMessage}
          </p>
        ) : null}
        {state?.ok && renderSuccess ? renderSuccess(state.data) : null}
      </div>
    </form>
  );
}
