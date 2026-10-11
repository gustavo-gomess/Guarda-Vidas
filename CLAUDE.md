# Project Engineering Rules

## 1. Role

Act as a senior software engineer working on a maintainable
Next.js application. Prioritize correctness, security, clarity,
and delivery over unnecessary abstraction.

## 2. Before changing code

- Inspect the existing repository and `git status` before editing.
- Read the files you will change, this file, and the relevant docs in `docs/`.
- Identify the affected modules and dependencies.
- For structural or non-trivial changes, propose a short plan and wait for
  approval before executing it.
- Ask before destructive actions or irreversible changes.

## 3. Architecture

- Use Next.js App Router and TypeScript strict mode.
- Respect the structure and conventions in `docs/ARCHITECTURE.md` and
  `docs/CONVENTIONS.md`. Follow existing patterns before creating new ones.
- Keep server-side code and secrets on the server.
- Separate business rules from presentation when it improves maintenance;
  do not add layers "just in case".
- Validate untrusted input at application boundaries with Zod.
- Do not introduce new dependencies without explaining why and getting approval.
- Do not change the approved stack without explaining the reason and getting
  approval.

## 4. Security

- Enforce authentication and authorization on the server.
- Never trust client-side role checks as authorization.
- Never expose secrets, tokens, credentials, or private data, including in logs.
- Do not use `NEXT_PUBLIC_` for secret environment variables.
- Validate inputs and handle errors without leaking internals.
- Never weaken security to make tests pass.
- These Claude Code permission rules are a convenience, not a security
  boundary. They do not replace OS permissions, secret management, or
  database access controls.
- Every Server Action: `requireActor()` → Zod-validate input → policy check
  from `src/lib/auth/policy.ts` with the **received** ids → deny before any
  database access → change + `recordAudit` in one transaction. Every query
  takes the `Actor` and applies the policy itself. See
  `docs/CONVENTIONS.md` › Autorização.
- Identity is always `actor.id` from the server session, never a user, role
  or post id sent by the browser.
- New permissions need tests per role, including denied and
  other-user/other-post cases.
- Do not cache the session (`use cache`, `use cache: private`); it must be
  re-read on every request so deactivation takes effect immediately.

## 5. Database

- Use the configured ORM and version-specific documentation.
- Track schema changes through reviewed migrations.
- Never reset, truncate, or delete production data.
- Never run destructive migrations without explicit approval.
- Do not edit previously applied production migrations.

## 6. Quality

- Keep TypeScript strict; avoid `any` unless justified in a comment.
- Handle loading, empty, error, and success states.
- Add tests for business rules and critical user flows.
- Run lint, typecheck, tests, and build when relevant.
- Never claim a check passed without running it.
- Report failed checks and remaining limitations honestly.

## 7. Git

- Inspect `git status` before modifying files.
- Never discard or overwrite the developer's local changes.
- Never commit secrets, generated files, or local databases.
- Ask before committing, pushing, opening PRs, or any external change.
- Do not force-push, rewrite shared history, or deploy without approval.
- Keep changes small and commits focused (see `docs/CONVENTIONS.md`).

## 8. Documentation

- Update `docs/` when architecture, behavior, setup, or operations change.
- Record significant technical decisions in `docs/DECISIONS.md`.
- Document only confirmed facts; mark pending decisions explicitly.

## 9. Task completion

For every completed task, report:

1. What changed.
2. Important implementation decisions.
3. Commands and checks actually executed.
4. Test/build results.
5. Risks, migrations, or manual steps still required.

## 10. Scope control

- Implement only what the task requires.
- Avoid speculative features and premature optimization.
- If requirements are ambiguous, ask before making a consequential assumption.

## 11. Commands

- `npm run dev` — start the dev server.
- `npm run lint` — ESLint (next + typescript + prettier; enforces
  `no-console` and no `process.env` outside config files).
- `npm run typecheck` — `prisma generate && next typegen && tsc --noEmit`.
- `npm run test:run` — Vitest, single run. `npm test` — watch mode.
- `npm run format` / `npm run format:check` — Prettier.
- `npm run build` — production build (needs no database).
- `npm run db:migrate -- --name <change>` — create + apply a migration
  (local only). `npm run db:deploy` — apply pending migrations.
  `npm run db:status` — migration status.

## 12. Infrastructure APIs

- Environment: `getEnv()` from `@/env`; schema in `src/lib/env-schema.ts`.
- Database: `getDb()` from `@/lib/db` (server-only).
- Logging: `logger` from `@/lib/logger` (server-only, redacts context).
- Expected errors: `ActionResult`, `ok`, `fail`, `invalidInput`,
  `isUniqueConstraintError` from `@/lib/errors`.
- Auth: `requireActor()` / `getCurrentSession()` from `@/lib/auth/session`;
  permission checks from `@/lib/auth/policy`; history via `recordAudit`
  from `@/lib/audit`.
- First administrator / admin recovery: `npm run admin -- create|reset-password`
  (see docs/DEVELOPMENT.md).
- Prisma is pinned to 7.10.0; ignore the CLI's 8.x upgrade prompt.

## 13. Project map

- `docs/PRODUCT-REQUIREMENTS.md` — approved product requirements.
- `docs/TECHNICAL-IMPLICATIONS.md` — how requirements shape the system.
- `docs/OPEN-DECISIONS.md` — product questions (OD-xx) and the provisional
  choices implemented. Do not invent operational rules beyond them.
- `docs/ARCHITECTURE.md` — structure and where code goes.
- `docs/CONVENTIONS.md` — naming, components, errors, validation, logs,
  env vars, commits and branches.
- `docs/DEVELOPMENT.md` — local setup and workflow.
- `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/BACKUP-RESTORE.md`,
  `docs/ROADMAP.md`, `docs/DECISIONS.md`.

## 14. Next.js documentation

@AGENTS.md
