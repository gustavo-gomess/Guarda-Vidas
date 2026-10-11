# Desenvolvimento

## Pré-requisitos

- Node.js 22 (`.nvmrc`). Verifique com `node -v`.
- npm 10+ (vem com o Node).
- Git.
- Docker (Docker Desktop no Windows/macOS) para o PostgreSQL local.

> **Recomendação para Windows:** mantenha o repositório **fora** de pastas
> sincronizadas (OneDrive, Dropbox). A sincronização de `node_modules`,
> `.next` e `src/generated` causa travamentos de arquivo (EPERM/EBUSY) e
> lentidão. Exemplo: `C:\dev\Guarda-Vidas`.

## Primeira execução

```bash
npm ci                        # instala dependências; o postinstall gera o cliente Prisma
cp .env.example .env.local    # Windows (PowerShell): Copy-Item .env.example .env.local
docker compose up -d          # PostgreSQL 17 em 127.0.0.1:5432
npm run db:deploy             # aplica migrações existentes
npm run admin -- create --username seu.usuario --name "Seu Nome"
npm run dev                   # http://localhost:3000 → /login
```

Confira a saúde em http://localhost:3000/api/health:

- `{"status":"ok","database":"ok"}` (HTTP 200): tudo certo.
- `{"status":"error","database":"unavailable"}` (HTTP 503): o servidor está
  de pé, mas não alcança o banco. O motivo aparece no log do terminal.

Use `npm ci` (respeita o `package-lock.json`). Use `npm install <pacote>`
apenas para adicionar uma dependência aprovada.

## Primeiro administrador

O sistema não tem cadastro público. O primeiro administrador é criado pela
linha de comando, por quem tem acesso ao banco; os demais usuários são
criados por ele na interface (**Usuários**).

```bash
npm run admin -- create --username joao.silva --name "João Silva"
# opcional: --role AUTHORITY   (padrão: COORDINATOR; guarda-vidas não pode ser admin)
```

O comando:

1. **Recusa** executar se já existir administrador ativo, para que não sirva
   de atalho para criar contas privilegiadas.
2. **Gera** uma senha temporária forte e a mostra **uma única vez** no
   terminal. Ela não é recebida como argumento (não fica no histórico do
   shell), não é registrada em log e não é salva (só o hash `scrypt`).
3. Marca a conta com troca obrigatória de senha: no primeiro login, o
   sistema só libera a tela **Alterar senha**.
4. Registra a criação no histórico de alterações (autor: "linha de
   comando").

Boas práticas:

- Rode em uma máquina confiável, com `DATABASE_URL` do ambiente certo (em
  produção, pela variável de ambiente, nunca em arquivo commitado).
- Faça o primeiro login logo em seguida e troque a senha; limpe o terminal.
- Crie um **segundo administrador** pela interface, para não depender de
  uma única pessoa.

**Administrador sem acesso** (senha esquecida ou conta bloqueada):

```bash
npm run admin -- reset-password --username joao.silva
```

Funciona só para administradores ativos, gera nova senha temporária,
desbloqueia a conta, encerra as sessões e registra no histórico. Os demais
usuários têm a senha redefinida por um administrador na interface. Não há
recuperação por e-mail (OD-23).

## Banco de dados local

- Definido em `docker-compose.yml`: usuário `guarda_vidas`, senha
  `guarda_vidas_dev`, banco `guarda_vidas`. São credenciais **só de
  desenvolvimento**, expostas apenas em `127.0.0.1`.
- Dados persistem no volume Docker `db-data`.
- Parar: `docker compose stop`. Remover o contêiner mantendo os dados:
  `docker compose down`.
- Apagar **todos** os dados locais: `docker compose down -v`. É destrutivo;
  só no banco local.

## Migrações (Prisma 7)

- Schema: `prisma/schema.prisma`. Configuração: `prisma7.config.ts` (lê
  `.env.local` e `.env`, porque o Prisma 7 não carrega `.env` sozinho).
- Cliente gerado em `src/generated/prisma/` (ignorado pelo Git). É gerado
  automaticamente em `npm ci`, `npm run build` e `npm run typecheck`.
- Criar uma migração depois de alterar o schema:
  `npm run db:migrate -- --name descricao_da_mudanca`. Revise o SQL gerado
  em `prisma/migrations/` antes de commitar.
- Aplicar migrações existentes (CI, produção, colegas):
  `npm run db:deploy`.
- A tabela `AuditLog` tem triggers que bloqueiam `UPDATE`, `DELETE` e
  `TRUNCATE` (escritos à mão na migração `auth_users_posts`). O Prisma não
  enxerga triggers; preserve-os ao editar migrações.
- **Nunca** use `prisma db push` nem `prisma migrate reset` fora do banco
  local; ambos podem apagar dados. As permissões do Claude Code bloqueiam
  `migrate reset` e `db push --force-reset`.
- Não edite migrações já aplicadas em produção; crie uma nova.

## Verificações antes de commitar

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Ainda não há hooks de pre-commit nem CI: as verificações são manuais.

## Fluxo de trabalho

1. Atualize `main` e crie uma branch: `feat/<assunto>` (veja
   `CONVENTIONS.md`).
2. Faça mudanças pequenas; rode as verificações.
3. Commit no formato Conventional Commits.
4. Abra um Pull Request para `main` (CI ainda não configurado).

## Variáveis de ambiente

| Variável       | Obrigatória | Padrão        | Descrição                         |
| -------------- | ----------- | ------------- | --------------------------------- |
| `DATABASE_URL` | sim         | —             | URL `postgresql://` do banco      |
| `LOG_LEVEL`    | não         | `info`        | `debug`, `info`, `warn`, `error`  |
| `NODE_ENV`     | não         | `development` | Definido pelo Next.js; não altere |

Para adicionar uma variável:

1. Declare no schema em `src/lib/env-schema.ts` (e um teste, se tiver regra).
2. Documente em `.env.example` com um valor de exemplo seguro.
3. Coloque o valor real em `.env.local` (nunca commitado).
4. Leia com `getEnv()` de `@/env`. O ESLint bloqueia `process.env` fora dos
   arquivos de configuração.

A validação acontece no start do servidor (`src/instrumentation.ts`). Se
algo estiver errado, o processo **encerra** com uma mensagem como:

```
Variáveis de ambiente inválidas:
  - DATABASE_URL: é obrigatória (ex.: postgresql://usuario:senha@localhost:5432/banco)
Confira .env.local (veja .env.example) ou as variáveis da hospedagem.
```

A mensagem cita o nome da variável, nunca o valor. O build (`npm run
build`) não valida o ambiente nem precisa de banco.

## Solução de problemas

| Sintoma                                                | Causa provável / solução                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Servidor encerra com "Variáveis de ambiente inválidas" | Falta `.env.local` ou um valor está errado; compare com `.env.example` |
| `/api/health` responde 503                             | Banco parado: `docker compose up -d`; veja o log do servidor           |
| `Cannot find module '@/generated/prisma/client'`       | Rode `npm run db:generate`                                             |
| Docker: "unable to start" / daemon indisponível        | Abra o Docker Desktop e aguarde; no Windows ele depende do WSL 2       |
| EPERM/EBUSY no Windows                                 | Pasta sincronizada (OneDrive); mova o repositório                      |

## Claude Code

- Regras do projeto: `CLAUDE.md`. Permissões: `.claude/settings.json`.
- Abra a sessão **na pasta do repositório** (`Guarda-Vidas/`); se aberta em
  uma pasta acima, as regras e permissões do projeto não são carregadas
  automaticamente.
- Ajustes pessoais de permissão vão em `.claude/settings.local.json`, que é
  ignorado pelo Git.
- O `AGENTS.md` é gerado e mantido pelo `next dev`; não edite à mão.

## Documentação do Next.js

A documentação da versão instalada fica em `node_modules/next/dist/docs/`.
Prefira-a a exemplos da internet, que podem ser de versões anteriores.
