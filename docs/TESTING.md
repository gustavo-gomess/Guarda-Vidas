# Testes

## Estado atual

| Tipo                   | Ferramenta | Estado                                                                                |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------- |
| Unitários              | Vitest 5   | **Configurado.** Infraestrutura, autenticação, permissões, Server Actions e consultas |
| Integração com o banco | Vitest 5   | **Configurado, opcional.** Roda com `TEST_DATABASE_URL`                               |
| Componentes React      | —          | Não configurado (sem componente com lógica que justifique)                            |
| End-to-end / offline   | Playwright | Não instalado                                                                         |

## Como rodar

```bash
npm test            # modo observação, reexecuta ao salvar
npm run test:run    # execução única (use antes de commitar e no CI)

# Integração (PostgreSQL DESCARTÁVEL, com migrações aplicadas):
TEST_DATABASE_URL=postgresql://... npm run test:run

# Com `prisma dev` (aceita uma conexão por vez), rode os arquivos em série:
TEST_DATABASE_URL=postgres://... npx vitest run tests/integration --no-file-parallelism
```

Sem `TEST_DATABASE_URL`, os testes de integração aparecem como _skipped_.
**Nunca** aponte `TEST_DATABASE_URL` para um banco com dados reais: os
testes criam registros.

## Configuração

`vitest.config.mts`:

- Ambiente `node`.
- Arquivos: `src/**/*.test.ts` e `tests/**/*.test.ts`.
- Alias `@/` → `src/`, igual ao `tsconfig.json`.
- `server-only` aponta para `tests/server-only-stub.ts`. O Next.js resolve
  esse import internamente, mas fora dele o pacote não existe.

Apoio em `tests/support/`:

- `actors.ts`: atores prontos (admin, autoridade, coordenador do posto A,
  guarda-vidas e capitão do posto A), IDs de posto e `form()` para montar
  `FormData`.
- `memory-auth-store.ts`: `AuthStore` em memória para testar login e sessão
  sem banco.

Testes de Server Actions e consultas usam `vi.mock` para `@/lib/auth/session`,
`@/lib/db`, `@/lib/logger` e `next/*`, e chamam as funções diretamente,
**como uma requisição forjada faria**, sem passar pela interface.

## O que já é testado

| Área                                 | Arquivo de teste                                        | O que garante                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ambiente                             | `src/lib/env-schema.test.ts`                            | Erros claros que nunca mostram valores                                                                                                                                                                                                           |
| Logs                                 | `src/lib/logger-core.test.ts`                           | Ocultação de chaves sensíveis sem esconder IDs                                                                                                                                                                                                   |
| Erros                                | `src/lib/errors.test.ts`                                | `ActionResult` e erros do Zod                                                                                                                                                                                                                    |
| Senhas                               | `src/lib/auth/password.test.ts`                         | Hash `scrypt`, sal aleatório, senha errada, hash malformado, rehash, senha temporária                                                                                                                                                            |
| **Login e sessão**                   | `src/lib/auth/auth-service.test.ts`                     | Login correto/errado/inexistente; **usuário inativo**; bloqueio após 5 falhas e liberação; **sessão expirada** (ociosa e absoluta); renovação; logout; token salvo só como hash                                                                  |
| **Permissões por perfil**            | `src/lib/auth/policy.test.ts`                           | Autoridade (só leitura), coordenador (só a própria área), guarda-vidas, capitão (só no seu posto), admin; atributos forjados ignorados                                                                                                           |
| Regras de contas                     | `src/features/users/rules.test.ts`                      | Ninguém altera o próprio acesso; guarda-vidas não é admin; sempre há um admin ativo                                                                                                                                                              |
| **Server Actions**                   | `src/features/*/actions.test.ts`                        | **Acesso negado** para cada perfil sem permissão, sem tocar no banco; coordenador enviando posto de outra área; IDs malformados; auditoria gravada; senha temporária e hash **fora dos logs**; login com mensagem genérica                       |
| **Outro usuário/posto**              | `src/features/*/queries.test.ts`                        | Trocar o ID do posto ou do usuário não revela dados; `passwordHash` nunca selecionado                                                                                                                                                            |
| Banco real                           | `tests/integration/auth-db.test.ts`                     | Fluxo completo via Prisma; desativação revoga sessão; usuário único; auditoria **imutável** (UPDATE/DELETE/TRUNCATE bloqueados) e sem campos sensíveis                                                                                           |
| Datas                                | `src/lib/dates.test.ts`                                 | Dia operacional em São Paulo (não UTC); datas inválidas; virada de mês e ano                                                                                                                                                                     |
| **Regras de escala**                 | `src/features/schedules/rules.test.ts`                  | **Períodos** (três dias, sem sobreposição, sem passado); **conflitos** (dois postos no mesmo dia, duplicado); equipe; posto fora de operação; justificativa; **confirmação** e estados                                                           |
| **Escala e disponibilidade (ações)** | `src/features/{schedules,availability}/actions.test.ts` | Negado a autoridade, admin fora da área, guarda-vidas e capitão; posto vem da escala, não do formulário; conflito vindo do banco; confirmação; **alteração** exige justificativa e marca "alterada"; disponibilidade sempre do usuário da sessão |
| **Quem vê a escala**                 | `src/features/schedules/queries.test.ts`                | Guarda-vidas só vê os próprios dias publicados (o filtro "profissional" não amplia); coordenador só a área; autoridade tudo, sem edição; filtros de data, posto e profissional                                                                   |
| Escala no banco real                 | `tests/integration/schedules-db.test.ts`                | Fluxo completo com as ações reais: janela → disponibilidade → proposta → conflito entre postos → confirmação → alteração com justificativa → histórico; restrição única do banco                                                                 |

### Verificação manual ponta a ponta (registrada em 2026-10-10)

Com o build de produção e PostgreSQL real, requisições HTTP com e sem
cookie confirmaram: sem cookie, cookie forjado e sessão expirada →
redirecionamento para `/login`; guarda-vidas não abre posto de outro (troca
de ID na URL) nem páginas de administração (404); administrador acessa;
guarda-vidas desativado perde o acesso imediatamente e sua sessão é apagada.
Ainda não automatizado (Playwright pendente).

### Verificação manual das escalas (registrada em 2026-10-10)

Build de produção + PostgreSQL (`prisma dev`), sessões criadas no banco e
requisições HTTP por perfil, 11 de 11 casos ok: coordenador vê "Montar
escala", edita e vê o histórico com justificativa; coordenador de outro
posto e guarda-vidas recebem 404 na escala do posto A; autoridade vê
"Somente consulta" sem botões de edição; guarda-vidas vê "Minha escala"
com o seu dia, não abre o quadro de disponibilidade e não vê "Abrir
janela". Os envios de formulário (Server Actions) pelo navegador não foram
exercitados; as ações foram testadas diretamente no teste de integração.

## Planejado

### End-to-end e offline — Playwright

- Automatizar a verificação acima e os fluxos críticos (login, entrada no
  turno, sincronização offline, alertas) em `e2e/*.spec.ts`, contra o build
  de produção.
- Perda de conexão simulada com `context.setOffline(true)`.
- Complementado por teste de campo em aparelhos reais (Android e iOS).

### Integração no CI

- Serviço PostgreSQL no GitHub Actions, `prisma migrate deploy` e
  `TEST_DATABASE_URL` apontando para ele.

### Componentes

- Testing Library + jsdom, quando houver componente com lógica que
  justifique.

## O que deve ter teste

- Toda regra de negócio com condição, cálculo, estado ou permissão.
- Todo schema de validação de entrada não trivial.
- Toda nova permissão: cada perfil, **acesso negado** e tentativa sobre
  **outro usuário ou outro posto**, na política e na Server Action.
- Bugs corrigidos: um teste que reproduza o bug antes da correção.
