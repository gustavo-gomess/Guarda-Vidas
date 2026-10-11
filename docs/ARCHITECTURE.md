# Arquitetura

> Estado em 2026-10-10. O produto ainda não tem funcionalidades de negócio;
> este documento descreve a fundação técnica e onde cada tipo de código deve
> ficar quando for criado. Requisitos do produto: `PRODUCT-REQUIREMENTS.md`;
> impactos técnicos: `TECHNICAL-IMPLICATIONS.md`.

## Stack confirmada

| Camada         | Tecnologia                                  | Versão instalada   |
| -------------- | ------------------------------------------- | ------------------ |
| Runtime        | Node.js                                     | 22 (`.nvmrc`)      |
| Framework      | Next.js (App Router, Turbopack)             | 16.4.0             |
| UI             | React                                       | 19.3.0             |
| Linguagem      | TypeScript (strict)                         | 5.9.x              |
| Estilo         | Tailwind CSS (via `@tailwindcss/turbopack`) | 4.x                |
| Validação      | Zod                                         | 4.6.x              |
| Banco          | PostgreSQL (local via Docker)               | 17                 |
| ORM            | Prisma + `@prisma/adapter-pg`               | 7.10.0 (fixado)    |
| Testes         | Vitest                                      | 5.x                |
| Lint / formato | ESLint 9 + `eslint-config-next`, Prettier 3 | ver `package.json` |

Autenticação própria (sem biblioteca; D008). Ainda **não** instalados (fase
futura ou decisão pendente): Playwright, PWA/service worker, GitHub
Actions. Veja `ROADMAP.md`.

## Modelo de dados atual

| Tabela            | Para quê                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`            | Conta individual: usuário, nome, perfil (`AUTHORITY`, `COORDINATOR`, `LIFEGUARD`), `isAdmin`, `active`, hash da senha, troca obrigatória, bloqueio |
| `Session`         | Sessões abertas (id = SHA-256 do token), expiração ociosa e absoluta                                                                               |
| `Post`            | Posto (nome, ativo)                                                                                                                                |
| `PostCoordinator` | Área do coordenador (postos que coordena)                                                                                                          |
| `PostAssignment`  | Equipe base do posto; `isCaptain` marca o capitão                                                                                                  |
| `AuditLog`        | Histórico só de inserção (autor, ação, entidade, posto, antes/depois); triggers impedem alteração                                                  |

## Autenticação e autorização

```
cookie (token) ──► getCurrentSession() ──► validateSession() ──► loadActor()
                    src/lib/auth/session.ts   auth-service.ts       (banco: perfil,
                    (por requisição,           (expiração, usuário    áreas, equipe,
                     connection())              ativo)                capitão)
                                                                        │
                                       Actor ◄──────────────────────────┘
                                         │
        ┌────────────────────────────────┼─────────────────────────────┐
   páginas: requireActor()        Server Actions:               queries.ts:
   + query(actor) → notFound()    requireActor() → Zod →        policy(actor, id)
                                  policy(actor, ids recebidos)   antes de buscar
                                  → transação + recordAudit
```

| Arquivo                             | Responsabilidade                                      |
| ----------------------------------- | ----------------------------------------------------- |
| `src/lib/auth/password.ts`          | Hash `scrypt`, verificação, senha temporária          |
| `src/lib/auth/tokens.ts`            | Token de sessão e seu hash                            |
| `src/lib/auth/auth-service.ts`      | Regras de login e sessão (puras, testadas)            |
| `src/lib/auth/prisma-auth-store.ts` | Implementação Prisma do `AuthStore`                   |
| `src/lib/auth/session.ts`           | Cookies, `getCurrentSession`, `requireActor`          |
| `src/lib/auth/policy.ts`            | Todas as regras de permissão (puras, testadas)        |
| `src/lib/audit.ts`                  | `recordAudit` (mesma transação, sem campos sensíveis) |
| `src/features/auth/`                | Login, logout, troca de senha                         |
| `src/features/users/`               | Administração de contas                               |
| `src/features/posts/`               | Postos, áreas de coordenação, equipe e capitão        |
| `scripts/admin.ts`                  | Primeiro administrador e recuperação de admin         |

### Rotas

| Rota                                                           | Quem acessa                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/login`                                                       | Público                                                                   |
| `/`                                                            | Qualquer usuário autenticado (vê os postos permitidos)                    |
| `/conta/senha`                                                 | Usuário autenticado (única liberada com senha temporária)                 |
| `/postos/[postId]`                                             | Quem pode ver o posto; gestão de equipe para coordenador do posto e admin |
| `/admin/usuarios`, `/admin/usuarios/[userId]`, `/admin/postos` | Somente administradores (404 para os demais)                              |
| `/api/health`                                                  | Público (sem dados)                                                       |

### Recursos do Next.js habilitados

Definidos em `next.config.ts`, vindos do template oficial:

- `cacheComponents: true`: busca de dados é **dinâmica por padrão**; cache é
  opt-in com a diretiva `"use cache"` (página, componente ou função). Conteúdo
  dinâmico precisa estar dentro de `<Suspense>` para não bloquear o shell
  estático.
- `partialPrefetching: true`.
- `poweredByHeader: false` e headers de segurança básicos (`nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; HSTS só
  em produção). **CSP pendente** (veja `DEPLOYMENT.md`).

## Estrutura atual

```
Guarda-Vidas/
├── .claude/settings.json      # permissões do Claude Code (versionadas)
├── docs/                      # documentação do projeto
├── prisma/
│   ├── schema.prisma          # usuários, sessões, postos, vínculos, auditoria
│   └── migrations/            # migrações revisadas (inclui triggers da auditoria)
├── public/                    # arquivos estáticos (vazio por enquanto)
├── scripts/admin.ts           # primeiro administrador / recuperação de admin
├── src/
│   ├── app/                   # rotas (App Router)
│   │   ├── login/, conta/senha/, postos/[postId]/
│   │   ├── admin/usuarios/, admin/usuarios/[userId]/, admin/postos/
│   │   ├── api/health/route.ts  # saúde do servidor e do banco
│   │   ├── error.tsx          # erro inesperado num segmento
│   │   ├── global-error.tsx   # erro no layout raiz
│   │   ├── not-found.tsx      # 404
│   │   ├── layout.tsx, page.tsx, globals.css, favicon.ico
│   ├── components/ui/         # ActionForm, Field, PageShell, AuditList
│   ├── features/
│   │   ├── auth/              # login, logout, troca de senha
│   │   ├── users/             # administração de contas (rules.ts testado)
│   │   └── posts/             # postos, áreas, equipe, capitão
│   ├── generated/prisma/      # cliente Prisma gerado (fora do Git)
│   ├── lib/
│   │   ├── auth/              # senha, tokens, sessão, política (veja abaixo)
│   │   ├── audit.ts           # recordAudit
│   │   ├── db.ts              # cliente Prisma compartilhado (server-only, lazy)
│   │   ├── env-schema.ts      # schema Zod do ambiente (puro, testado)
│   │   ├── errors.ts          # ActionResult, ok, fail, invalidInput (testado)
│   │   ├── logger-core.ts     # logger com ocultação de dados (puro, testado)
│   │   ├── logger.ts          # instância do logger (server-only)
│   │   └── startup.ts         # validação no start; encerra se inválido
│   ├── env.ts                 # getEnv(): ambiente validado (server-only)
│   └── instrumentation.ts     # register() e onRequestError()
├── tests/
│   ├── support/               # atores de teste, AuthStore em memória
│   └── integration/           # testes contra PostgreSQL real (opcionais)
├── docker-compose.yml         # PostgreSQL local
├── prisma7.config.ts          # configuração do Prisma 7
├── vitest.config.mts
├── AGENTS.md                  # regras do Next.js para agentes (gerado pelo Next)
└── CLAUDE.md                  # regras de engenharia para o Claude Code
```

### Fluxos de infraestrutura

- **Ambiente:** `getEnv()` valida `process.env` com `env-schema.ts` na
  primeira chamada e guarda o resultado. `instrumentation.ts` chama
  `runStartupChecks()` no start (runtime Node.js): ambiente inválido encerra
  o processo com mensagem clara. O build não valida o ambiente.
- **Banco:** `getDb()` cria o `PrismaClient` com o adapter `pg` no primeiro
  uso e reutiliza a instância (inclusive entre hot reloads). Queries não
  são logadas.
- **Erros:** esperados → `ActionResult`; inesperados → `error.tsx` /
  `global-error.tsx` no cliente e `onRequestError` (log com método, rota e
  erro, sem query string nem headers) no servidor.
- **Logs:** `logger` (JSON em produção, texto em desenvolvimento) oculta
  chaves sensíveis do contexto. O ESLint proíbe `console` fora de
  `logger-core.ts` e `process.env` fora dos arquivos de configuração.

## Onde colocar código novo

Diretórios são criados **quando o primeiro arquivo real precisar deles**,
nunca vazios. Todos ficam sob `src/` e são importados com o alias `@/`.

| Diretório                 | Conteúdo                                                                                             | Criar quando                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `src/app/`                | Somente arquivos de rota (`page`, `layout`, `loading`, `error`, `not-found`, `route`). Pouca lógica. | já existe                                 |
| `src/components/ui/`      | Componentes visuais genéricos e reutilizáveis, sem regra de negócio.                                 | o 1º componente for usado em 2+ lugares   |
| `src/features/<feature>/` | Tudo de uma funcionalidade: componentes, Server Actions, schemas Zod, regras e queries.              | a 1ª funcionalidade de negócio for criada |
| `src/lib/`                | Infraestrutura compartilhada sem regra de negócio (cliente do banco, logger, utilitários).           | já existe                                 |
| `prisma/`                 | `schema.prisma` e migrações.                                                                         | já existe                                 |
| `tests/`                  | Testes de integração e utilitários de teste compartilhados.                                          | já existe                                 |
| `e2e/`                    | Testes Playwright.                                                                                   | houver fluxo crítico para cobrir          |
| `.github/workflows/`      | CI.                                                                                                  | a fase de CI for executada                |

Testes unitários ficam ao lado do arquivo testado (`rules.ts` →
`rules.test.ts`).

### Estrutura sugerida de uma feature

```
src/features/<feature>/
├── components/     # componentes da feature (Server por padrão)
├── actions.ts      # Server Actions ("use server")
├── schemas.ts      # schemas Zod e tipos inferidos
├── rules.ts        # regras de negócio puras (fáceis de testar)
└── queries.ts      # acesso a dados ("server-only")
```

Crie apenas os arquivos de que a feature precisa. Uma feature pode importar
de `components/ui` e `lib`, mas **não** de outra feature; código
compartilhado entre features sobe para `lib/` ou `components/ui/`.

## Fronteiras de servidor e cliente

- Componentes são **Server Components** por padrão.
- Código que acessa segredos, banco ou serviços internos importa
  `"server-only"` (tratado nativamente pelo Next.js, sem pacote extra).
- Variáveis de ambiente do servidor são lidas apenas via `getEnv()` de
  `src/env.ts`.
- Toda entrada não confiável (formulários, parâmetros de rota, search params,
  corpo de Route Handlers, respostas de APIs externas) é validada com Zod na
  fronteira.

## Decisões pendentes que afetam a arquitetura

- Modelo operacional (turnos, checklist, alertas…) — depende das decisões
  em `OPEN-DECISIONS.md`.
- Regras provisórias de perfis e sessão — OD-01, 02, 04, 07, 21, 22, 23.
- Estratégia offline (PWA, armazenamento local, sincronização).
- Hospedagem — veja `DEPLOYMENT.md`.
- Tratamento de dados pessoais (LGPD) — depende do domínio.
