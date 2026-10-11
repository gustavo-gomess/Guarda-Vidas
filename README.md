# Guarda-Vidas

Sistema de gestão de postos de guarda-vidas. Next.js (App Router), React,
TypeScript strict, Tailwind CSS, PostgreSQL + Prisma.

> Estado: fundação técnica pronta; módulos de negócio ainda não
> implementados (veja `docs/ROADMAP.md`).

## Requisitos

- Node.js 22 (veja `.nvmrc`) e npm 10+
- Docker (para o PostgreSQL local)

## Como rodar

```bash
npm ci                        # instala e gera o cliente Prisma
cp .env.example .env.local    # valores já apontam para o banco local
docker compose up -d          # sobe o PostgreSQL local
npm run db:deploy             # aplica as migrações
npm run admin -- create --username seu.usuario --name "Seu Nome"   # 1º administrador
npm run dev
```

- Aplicação: http://localhost:3000
- Saúde do servidor e do banco: http://localhost:3000/api/health

Se uma variável de ambiente faltar ou estiver inválida, o servidor não sobe e
mostra qual é o problema. Detalhes e solução de problemas em
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Scripts

| Comando                             | O que faz                                                       |
| ----------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                       | Servidor de desenvolvimento                                     |
| `npm run build`                     | Build de produção (não precisa de banco)                        |
| `npm run start`                     | Sobe o build de produção                                        |
| `npm run lint`                      | ESLint                                                          |
| `npm run typecheck`                 | Gera tipos (Prisma e rotas) e roda `tsc`                        |
| `npm run format`                    | Formata o código com Prettier                                   |
| `npm run format:check`              | Verifica a formatação sem alterar nada                          |
| `npm test`                          | Vitest em modo observação                                       |
| `npm run test:run`                  | Vitest, execução única                                          |
| `npm run db:migrate`                | Cria e aplica migração em desenvolvimento                       |
| `npm run db:deploy`                 | Aplica migrações pendentes (sem criar novas)                    |
| `npm run db:status`                 | Mostra o estado das migrações                                   |
| `npm run db:generate`               | Regenera o cliente Prisma                                       |
| `npm run admin -- create …`         | Cria o primeiro administrador (senha gerada e mostrada uma vez) |
| `npm run admin -- reset-password …` | Recupera o acesso de um administrador                           |

## Variáveis de ambiente

Declaradas e validadas em `src/lib/env-schema.ts`, lidas via `getEnv()` de
`@/env` e documentadas em `.env.example`. Arquivos `.env*` reais nunca são
commitados.

## Documentação

- [`CLAUDE.md`](CLAUDE.md) — regras de engenharia (também lidas pelo Claude Code).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, estrutura e onde colocar código.
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — padrões de código, erros, validação, logs, Git.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — setup local e fluxo de trabalho.
- [`docs/TESTING.md`](docs/TESTING.md) — estratégia de testes.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploy (pendente).
- [`docs/BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md) — backup e restauração (pendente).
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decisões técnicas.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — fases e pendências.
