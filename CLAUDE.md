# Project Engineering Rules

## 1. Role

Act as a senior software engineer working on a maintainable
Next.js application. Prioritize correctness, security, clarity,
and delivery over unnecessary abstraction.

## 2. Before changing code

- Inspect the existing repository and git status.
- Read this file and relevant documentation in docs/.
- Identify the affected modules and dependencies.
- For non-trivial changes, propose a short plan first.
- Ask before destructive actions or irreversible changes.

## 3. Architecture

- Use Next.js App Router and TypeScript strict mode.
- Keep server-side code and secrets on the server.
- Keep business rules separate from presentation where useful.
- Validate untrusted input at application boundaries with Zod.
- Follow the existing project structure before creating abstractions.
- Do not introduce new dependencies without explaining why.

## 4. Security

- Enforce authentication and authorization on the server.
- Never trust client-side role checks as authorization.
- Never expose secrets, tokens, credentials, or private data.
- Do not use NEXT_PUBLIC_ for secret environment variables.
- Validate inputs and handle errors without leaking internals.
- Never weaken security to make tests pass.

## 5. Database

- Use the configured ORM and version-specific documentation.
- Track schema changes through reviewed migrations.
- Never reset, truncate, or delete production data.
- Never run destructive migrations without explicit approval.
- Do not edit previously applied production migrations.

## 6. Quality

- Keep TypeScript strict; avoid any unless justified.
- Handle loading, empty, error, and success states.
- Add tests for business rules and critical user flows.
- Run lint, typecheck, tests, and build when relevant.
- Never claim a check passed without running it.
- Report failed checks and remaining limitations honestly.

## 7. Git

- Inspect git status before modifying files.
- Never discard the user's existing changes.
- Never commit secrets, generated files, or local databases.
- Do not force-push, rewrite shared history, or deploy without approval.
- Keep changes small and commits focused.

## 8. Task completion

For every completed task, report:

1. What changed.
2. Important implementation decisions.
3. Commands and checks actually executed.
4. Test/build results.
5. Risks, migrations, or manual steps still required.

## 9. Scope control

- Implement only what the task requires.
- Avoid speculative features and premature optimization.
- Update docs when architecture or behavior changes.
- If requirements are ambiguous, ask before making a consequential assumption.

## 10. Commands

- `npm run dev` — start the dev server.
- `npm run lint` — ESLint (next/core-web-vitals + typescript + prettier).
- `npm run typecheck` — `next typegen && tsc --noEmit`.
- `npm run format` / `npm run format:check` — Prettier.
- `npm run build` — production build.

## 11. Project structure

- `src/app/` — App Router routes, layouts and pages.
- `src/env.ts` — server environment variables validated with Zod.
  Read env through `env` from this module, never `process.env` directly.
  Keep `.env.example` in sync with it.
- `src/instrumentation.ts` — validates the environment at server start.
- `docs/` — architecture notes and decisions (ADRs).

## 12. Pinned versions

- Node 22 (`.nvmrc`), npm with a committed `package-lock.json`.
- ESLint stays on 9 and TypeScript on 5 until `eslint-config-next`'s
  plugins and `typescript-eslint` support newer majors. See docs/decisions.

## 13. Next.js documentation

@AGENTS.md
