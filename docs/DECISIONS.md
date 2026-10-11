# Decisões técnicas

Registro das decisões técnicas relevantes, da mais antiga para a mais nova.
Uma decisão aceita só muda com uma nova entrada que a substitua; não edite o
histórico.

Formato: **Contexto**, **Decisão**, **Consequências**. Status: `aceita`,
`substituída por DNNN` ou `pendente`.

---

## D001 — Fundação técnica

- Status: aceita · Data: 2026-10-10

**Contexto.** Projeto iniciado do zero. Em 2026-10-10 as versões `latest` do
npm não eram todas compatíveis entre si.

**Decisão.**

1. Base gerada com `create-next-app@16.4.0` (App Router, `src/`, Tailwind,
   ESLint, alias `@/*`), mantendo os defaults do template (`cacheComponents`,
   `partialPrefetching`, `@tailwindcss/turbopack`).
2. **TypeScript 5.x, não 7.x.** `typescript-eslint` 8.71 exige
   `typescript <6.1.0`; o template oficial do Next 16.4 usa `^5`.
3. **ESLint 9, não 10.** `eslint-plugin-react`, `eslint-plugin-import` e
   `eslint-plugin-jsx-a11y` (dependências de `eslint-config-next`) ainda não
   declaram suporte ao ESLint 10.
4. **Prisma, quando adotado, em versão estável fixada.** A dist-tag `latest`
   apontava para `8.0.0-rc.22`; o último estável era `7.10.0`.
5. **Node 22 LTS** (`.nvmrc`, `engines`), **npm** com `package-lock.json`
   versionado.
6. **Prettier** com `prettier-plugin-tailwindcss`; `eslint-config-prettier`
   desliga regras de estilo conflitantes.
7. **Variáveis de ambiente validadas com Zod** em `src/env.ts`, carregado em
   `src/instrumentation.ts` para falhar no start do servidor.
8. **TypeScript mais estrito**: `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`.

**Consequências / riscos aceitos.**

- O npm marca o ESLint 9 como sem suporte. Reavaliar quando os plugins do
  `eslint-config-next` suportarem o ESLint 10.
- `npm audit` reporta 5 vulnerabilidades altas de uma única cadeia (DoS por
  padrões aninhados no `braces`): `eslint-config-next` →
  `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3`.
  Não há versão corrigida publicada, e `npm audit fix --force` rebaixaria
  para Next 14. Afeta só o lint em desenvolvimento, não o bundle de produção.
  Reavaliar a cada atualização do `eslint-config-next`.

---

## D002 — Estrutura de diretórios por feature, criada sob demanda

- Status: aceita · Data: 2026-10-10

**Contexto.** O projeto ainda não tem funcionalidades. Criar camadas vazias
(`services/`, `repositories/`, …) gera estrutura sem uso e decisões
prematuras.

**Decisão.** Código sob `src/`, com `app/` só para rotas,
`features/<feature>/` para cada funcionalidade, `components/ui/` para UI
genérica e `lib/` para infraestrutura. Diretórios são criados apenas quando
o primeiro arquivo real precisar deles. `src/env.ts` permanece na raiz de
`src/` (é importado como `@/env`). Detalhes em `ARCHITECTURE.md`.

**Consequências.** Features não importam umas das outras; código
compartilhado sobe para `lib/` ou `components/ui/`.

---

## D003 — Permissões do Claude Code conservadoras e versionadas

- Status: aceita · Data: 2026-10-10

**Contexto.** O Claude Code (extensão VS Code 2.1.296) lê
`.claude/settings.json`. A documentação oficial informa que regras de
permissão casam com o texto do comando, **não são uma barreira de segurança**
(ex.: `/bin/rm` ou `sh -c` escapam de uma regra `rm *`) e recomenda o sandbox
para controle real de sistema de arquivos e rede.

**Decisão.**

- `allow`: apenas leitura e os scripts de verificação (`lint`, `typecheck`,
  `test:run`, `build`, `format:check`) e `git status/diff/log`, em Bash e
  PowerShell.
- `ask`: `git commit`, `git push`, `npm install/uninstall`, `npx prisma`,
  `vercel`, para que sempre peçam confirmação, mesmo que alguém amplie as
  permissões localmente.
- `deny`: force-push, `git reset --hard`, `git clean`, remoção recursiva,
  reset de banco pelo Prisma e leitura de `.env*` (exceto `.env.example`),
  `*.pem` e `*.key`.
- `disableBypassPermissionsMode: "disable"`.
- Ajustes pessoais vão para `.claude/settings.local.json` (ignorado pelo Git).

**Consequências.** Mais confirmações durante o desenvolvimento. A proteção
real de segredos continua sendo: não colocar segredos no repositório,
permissões do sistema operacional e gestão de segredos da hospedagem.

---

## D004 — Convenções de código e de Git

- Status: aceita · Data: 2026-10-10

**Decisão.** Convenções em `CONVENTIONS.md`: arquivos em `kebab-case`,
código em inglês e UI em pt-BR, Server Components por padrão, erros
esperados como valores de retorno, Zod em toda fronteira, Conventional
Commits e branches `tipo/assunto`.

**Consequências.** A ordem de imports e parte das convenções não são
verificadas automaticamente; dependem de revisão.

---

## D005 — PostgreSQL + Prisma 7.10 com adapter `pg`

- Status: aceita · Data: 2026-10-10

**Contexto.** Os requisitos (`PRODUCT-REQUIREMENTS.md`) exigem dados
persistentes, consistentes e auditáveis. A stack aprovada prevê PostgreSQL +
Prisma. O Prisma 7 exige driver adapter, não carrega `.env` sozinho e, a
partir do 7.10, procura primeiro `prisma7.config.ts` (verificado no código
de `@prisma/config` 7.10.0).

**Decisão.**

- `prisma`, `@prisma/client` e `@prisma/adapter-pg` fixados em **7.10.0**
  (`--save-exact`). O 8.0 está em release candidate; o aviso de atualização
  do CLI deve ser ignorado até uma decisão explícita.
- Gerador `prisma-client` com saída em `src/generated/prisma` (fora do Git),
  gerado em `postinstall`, `build` e `typecheck`.
- `prisma7.config.ts` carrega `.env.local`/`.env` com
  `process.loadEnvFile` (nativo do Node, sem `dotenv`) e lê `DATABASE_URL`
  via `process.env` em vez de `env()`, para o `generate` funcionar sem banco.
- Cliente criado sob demanda (`getDb()`), sem log de queries.
- PostgreSQL 17 local via `docker-compose.yml`, exposto só em `127.0.0.1`.
- Migrações só por `migrate dev` (local) e `migrate deploy` (demais
  ambientes). Sem `db push`.
- Nenhum modelo de negócio nesta etapa.

**Consequências.** O build não precisa de banco. Toda mudança de schema
passa por migração revisada.

**Risco aceito.** O CLI `prisma@7.10.0` (dependência de desenvolvimento)
traz 4 alertas altos do `npm audit` (total do projeto: 9):
`prisma → mysql2@3.15.3` (vazamento de credencial / DoS no protocolo
MySQL; o projeto não conecta a MySQL) e
`prisma → @prisma/config → deepmerge-ts@7.1.5` (estouro de pilha ao mesclar
objetos recursivos; só mescla o nosso `prisma7.config.ts`). O runtime
(`@prisma/client`, `@prisma/adapter-pg`) não depende desses pacotes. A
correção sugerida rebaixaria para Prisma 6; `overrides` exigiria um salto
major no `deepmerge-ts`. Reavaliar a cada atualização do Prisma.

---

## D006 — Vitest como única ferramenta de testes por enquanto

- Status: aceita · Data: 2026-10-10

**Decisão.** Vitest 5 em ambiente `node`, testes ao lado do código,
`server-only` substituído por um módulo vazio nos testes. Testing Library,
jsdom e Playwright ficam para quando houver componentes ou fluxos que os
justifiquem. Configuração em `vitest.config.mts` (`.mts` porque o
`package.json` não é `"type": "module"`).

---

## D007 — Ambiente, erros e logs sem dependências novas

- Status: aceita · Data: 2026-10-10

**Contexto.** Era preciso validar o ambiente com erro claro, padronizar
erros e registrar logs sem expor dados sensíveis, sem infraestrutura
desnecessária.

**Decisão.**

- **Ambiente:** schema puro em `src/lib/env-schema.ts`; `getEnv()` valida na
  primeira chamada (não na importação), porque o `next build` importa os
  módulos de rota e não deve exigir segredos. Em
  `instrumentation.ts`, ambiente inválido **encerra o processo** (código 1):
  testado que, sem isso, o Next.js 16.4 registra o erro e continua servindo 500. Mensagens citam a variável, nunca o valor.
- **Erros:** `ActionResult` + `ok`/`fail`/`invalidInput`, seguindo a
  orientação do Next.js de modelar erros esperados como retorno;
  `error.tsx`, `global-error.tsx` e `not-found.tsx` em pt-BR;
  `onRequestError` registra erros do servidor.
- **Logs:** logger próprio (~100 linhas) sobre `console`, com JSON em
  produção e ocultação por **palavras inteiras** da chave (evita ocultar
  `authorId`). Não foi adotada biblioteca (ex.: pino): o volume esperado é
  baixo e a hospedagem ainda não foi escolhida.
- **ESLint** passa a impor `no-console` e a proibição de `process.env` fora
  dos arquivos de configuração.
- Headers de segurança básicos e `/api/health` (sem detalhes de erro na
  resposta).

**Consequências.** Trocar para uma biblioteca de logs depois exige mudar só
`logger.ts`/`logger-core.ts`. A ocultação não reconhece campos de texto
livre; a regra de nunca logar conteúdo continua valendo.

---

## D008 — Autenticação própria com sessões no banco

- Status: aceita · Data: 2026-10-10

**Contexto.** Requisitos: contas individuais, login/logout seguros,
usuários inativos sem novas sessões, permissões por perfil e posto,
auditoria. Escolhas de produto provisórias em `OPEN-DECISIONS.md` (OD-01,
02, 04, 07, 21, 22, 23).

**Decisão.**

- **Sem biblioteca de autenticação.** Login só com usuário e senha, sem
  provedores externos; o código necessário é pequeno e testável. JWT foi
  descartado porque não permite revogar sessão na hora (desativação).
- **Senhas:** `scrypt` nativo do Node (N=2^15, r=8, p=3, ~32 MiB, ~240 ms;
  OWASP). Parâmetros salvos no hash e rehash automático no login. Sem
  dependência nativa (argon2 exigiria binário por plataforma).
- **Sessões:** token aleatório de 256 bits em cookie `httpOnly`,
  `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção; no banco, só o
  SHA-256 do token. Expiração deslizante + absoluta. Sessão é lida a cada
  requisição com `await connection()`, nunca cacheada, nem por
  `use cache: private`: desativação e logout valem na hora (testado).
- **Login:** mensagem única para qualquer falha; verificação de senha
  "falsa" para usuários inexistentes ou bloqueados (tempo de resposta
  igual); bloqueio após 5 falhas; status inativo checado só depois da senha
  correta.
- **Autorização:** política pura em `src/lib/auth/policy.ts` sobre um
  `Actor` montado no servidor (sessão + banco). Toda Server Action chama
  `requireActor()` e a função da política com os IDs **recebidos**; toda
  consulta recebe o `Actor` e filtra. Páginas sem permissão respondem 404.
- **Capitão** = `PostAssignment.isCaptain`; **administrador** =
  `User.isAdmin`. Nenhum dos dois é perfil de autenticação.
- **Auditoria:** `recordAudit` na mesma transação da mudança; campos
  sensíveis descartados; triggers no PostgreSQL impedem `UPDATE`, `DELETE` e
  `TRUNCATE` do histórico.
- **Primeiro administrador:** `npm run admin -- create` (gera a senha,
  recusa se já houver admin ativo). `tsx` adicionado como dependência de
  desenvolvimento para rodar o script com os aliases do projeto.
- **Proxy (middleware) não usado:** a documentação do Next.js recomenda
  verificar perto dos dados; um proxy seria só otimização de
  redirecionamento.

**Consequências.** Toda nova Server Action ou consulta precisa seguir o
padrão (`CONVENTIONS.md` › Autorização) e ter teste de acesso negado.
Rate limiting por IP não existe (só bloqueio por conta); avaliar com a
hospedagem.

---

## D009 — Escalas: conflitos garantidos pelo banco

**Contexto.** Prompt 3: montar e confirmar escalas sem nunca colocar a mesma
pessoa em dois postos ao mesmo tempo, com histórico e estados separados.

**Decisão.**

- **Regras puras** em `src/features/schedules/rules.ts` (janela, conflito,
  justificativa, transições de estado), testadas sem banco; as Server
  Actions só carregam dados e aplicam essas funções.
- **Conflito no banco:** restrição única `ScheduleEntry(userId, date)`. A
  verificação da aplicação dá a mensagem clara ("já escalado no posto X");
  a restrição cobre duas pessoas escalando ao mesmo tempo (erro P2002 vira
  mensagem de conflito).
- **Ordem das alterações:** cada ação de escala autoriza pelo posto
  **lido do banco** (nunca um posto enviado pelo navegador), depois trava a
  linha da escala (`SELECT … FOR UPDATE`) e relê o estado na transação.
  Assim, confirmação e alteração simultâneas não se misturam (ex.: incluir
  alguém sem justificativa em uma escala que acabou de ser confirmada).
- **Janelas sem sobreposição:** verificação dentro de transação
  `Serializable`; duas aberturas simultâneas fazem uma falhar.
- **Datas** como `DATE` + texto `AAAA-MM-DD` no fuso operacional; nada de
  horário local do servidor.
- **Estados:** a disponibilidade é uma tabela separada da escala; a escala
  nasce `PROPOSED` e só `confirmScheduleAction` a publica. Sugestão
  automática não existe (OD-24).

**Alternativa descartada.** Restrição de exclusão (`EXCLUDE USING gist`)
para janelas: o Prisma não a representa no schema e geraria divergência
nas migrações; o volume de janelas não justifica.

**Consequências.** A escala é por dia inteiro: quando turnos tiverem
horário (OD-05), a restrição única muda para intervalo de horário.

---

## D010 — Presença offline sem dependências novas

**Contexto.** Prompt 4: entrada sem internet, provisória, sincronizada sem
duplicidade e validada pelo coordenador, preservando o original.

**Decisão.**

- **Service worker escrito à mão** (`public/sw.js`, ~100 linhas) em vez do
  Serwist: só precisamos de uma página e dos arquivos estáticos em cache.
  Evita dependência nova (que exigiria aprovação) e mantém o controle de
  que **nenhuma API é respondida pelo cache**.
- **IndexedDB nativo** para a fila (sem `idb`).
- **Route Handler** (`POST /api/presenca/registros`) para sincronizar, não
  Server Action: uma página aberta do cache pode ser de um deploy anterior,
  e os ids de Server Action mudam a cada deploy. A rota confere mesma
  origem, sessão, JSON e tamanho.
- **Idempotência pelo id gerado no aparelho** (UUID = chave primária) +
  hash do conteúdo: repetido devolve o original; id igual com dados
  diferentes é recusado. Concorrência resolvida pela restrição única e uma
  nova tentativa.
- **Preservação no banco:** triggers impedem alterar os dados de um
  registro (só `status` muda) e apagar registros, decisões ou jornadas.
- **Origem decidida pelo servidor:** online usa a hora do servidor; offline
  usa a hora declarada pelo aparelho, sempre com validação.
- **`Permissions-Policy`** passou de `geolocation=()` (bloqueava o GPS) para
  `geolocation=(self)`.

**Consequências.** O comportamento no navegador (service worker, IndexedDB,
GPS) não tem teste automatizado: precisa de Playwright e teste em campo.
Ao mudar `public/sw.js`, aumentar a versão dos caches (`gv-pages-v1`).

---

## D011 — Checklist: versões em vez de edição

**Contexto.** Prompt 5: um checklist por assunção, lista de itens
configurável sem alterar registros antigos, correções auditáveis e sem
duplicar envios.

**Decisão.**

- **Itens versionados:** `ChecklistItem` é só a identidade; o conteúdo fica
  em `ChecklistItemVersion` (nunca alterada). Editar = nova versão.
- **Cópia congelada:** ao iniciar, o checklist copia os itens ativos para
  `ChecklistLine` (nome e orientação da época). Mudar a lista depois não
  muda o checklist.
- **Respostas como versões completas:** cada salvamento grava uma
  `ChecklistRevision` com todas as respostas. "Atual" é um ponteiro
  (`currentRevisionId`); o histórico é a lista de versões, e as diferenças
  são calculadas na tela.
- **Idempotência:** o id da versão é gerado pelo navegador para cada
  tentativa; repetir a mesma tentativa devolve o que já foi gravado. Linha
  do checklist travada (`FOR UPDATE`) durante o salvamento.
- **Um checklist por jornada:** restrição única em `journeyId`; nada é
  copiado de outro checklist.
- **Triggers:** itens, versões, linhas, versões de resposta e respostas são
  só inserção; em `Checklist` só mudam situação, data de envio e versão
  atual.
- **Server Action** (não rota): o checklist é só online (OD-35), então não
  há página antiga em cache chamando ids de ação desatualizados.

**Consequências.** O banco cresce uma versão completa por salvamento (poucos
itens por checklist; aceitável). Se o checklist offline for aprovado, a
fila da presença pode ser reaproveitada com o mesmo id de envio.

---

## Decisões pendentes

Decisões de **produto** ficam em `OPEN-DECISIONS.md`. Pendências técnicas:

| Tema                          | Depende de                              |
| ----------------------------- | --------------------------------------- |
| Rate limiting de login por IP | Hospedagem (proxy/CDN)                  |
| Hospedagem                    | Banco gerenciado, orçamento, região     |
| Content-Security-Policy       | Service worker e scripts de terceiros   |
| PWA / armazenamento offline   | Matriz offline aprovada                 |
| Biblioteca de logs            | Hospedagem escolhida (só se necessário) |
