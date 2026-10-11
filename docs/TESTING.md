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

| Área                                 | Arquivo de teste                                        | O que garante                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ambiente                             | `src/lib/env-schema.test.ts`                            | Erros claros que nunca mostram valores                                                                                                                                                                                                                                                                                                      |
| Logs                                 | `src/lib/logger-core.test.ts`                           | Ocultação de chaves sensíveis sem esconder IDs                                                                                                                                                                                                                                                                                              |
| Erros                                | `src/lib/errors.test.ts`                                | `ActionResult` e erros do Zod                                                                                                                                                                                                                                                                                                               |
| Senhas                               | `src/lib/auth/password.test.ts`                         | Hash `scrypt`, sal aleatório, senha errada, hash malformado, rehash, senha temporária                                                                                                                                                                                                                                                       |
| **Login e sessão**                   | `src/lib/auth/auth-service.test.ts`                     | Login correto/errado/inexistente; **usuário inativo**; bloqueio após 5 falhas e liberação; **sessão expirada** (ociosa e absoluta); renovação; logout; token salvo só como hash                                                                                                                                                             |
| **Permissões por perfil**            | `src/lib/auth/policy.test.ts`                           | Autoridade (só leitura), coordenador (só a própria área), guarda-vidas, capitão (só no seu posto), admin; atributos forjados ignorados                                                                                                                                                                                                      |
| Regras de contas                     | `src/features/users/rules.test.ts`                      | Ninguém altera o próprio acesso; guarda-vidas não é admin; sempre há um admin ativo                                                                                                                                                                                                                                                         |
| **Server Actions**                   | `src/features/*/actions.test.ts`                        | **Acesso negado** para cada perfil sem permissão, sem tocar no banco; coordenador enviando posto de outra área; IDs malformados; auditoria gravada; senha temporária e hash **fora dos logs**; login com mensagem genérica                                                                                                                  |
| **Outro usuário/posto**              | `src/features/*/queries.test.ts`                        | Trocar o ID do posto ou do usuário não revela dados; `passwordHash` nunca selecionado                                                                                                                                                                                                                                                       |
| Banco real                           | `tests/integration/auth-db.test.ts`                     | Fluxo completo via Prisma; desativação revoga sessão; usuário único; auditoria **imutável** (UPDATE/DELETE/TRUNCATE bloqueados) e sem campos sensíveis                                                                                                                                                                                      |
| Datas                                | `src/lib/dates.test.ts`                                 | Dia operacional em São Paulo (não UTC); datas inválidas; virada de mês e ano                                                                                                                                                                                                                                                                |
| **Regras de escala**                 | `src/features/schedules/rules.test.ts`                  | **Períodos** (três dias, sem sobreposição, sem passado); **conflitos** (dois postos no mesmo dia, duplicado); equipe; posto fora de operação; justificativa; **confirmação** e estados                                                                                                                                                      |
| **Escala e disponibilidade (ações)** | `src/features/{schedules,availability}/actions.test.ts` | Negado a autoridade, admin fora da área, guarda-vidas e capitão; posto vem da escala, não do formulário; conflito vindo do banco; confirmação; **alteração** exige justificativa e marca "alterada"; disponibilidade sempre do usuário da sessão                                                                                            |
| **Quem vê a escala**                 | `src/features/schedules/queries.test.ts`                | Guarda-vidas só vê os próprios dias publicados (o filtro "profissional" não amplia); coordenador só a área; autoridade tudo, sem edição; filtros de data, posto e profissional                                                                                                                                                              |
| **Regras de presença**               | `src/features/attendance/rules.test.ts`                 | **Entrada online** (hora do servidor) e **offline** (provisória); relógio errado, no futuro, não medido; GPS ausente/impreciso/fora do raio; sem escala; **jornada duplicada**; **reenvio** (mesmo id, dados diferentes, outro usuário); **saída** (online, offline recusada, sem entrada, repetida, após rejeição); **validação/rejeição** |
| **Fila no aparelho**                 | `src/features/attendance/client/{queue,device}.test.ts` | Nada é apagado sem confirmação; falha de rede, sessão expirada, outra conta; reenvio com o mesmo id; resposta não JSON (portal de Wi-Fi) não conta como confirmação                                                                                                                                                                         |
| **Rota de sincronização**            | `src/app/api/presenca/registros/route.test.ts`          | Outra origem, sem sessão, senha temporária, JSON inválido, corpo grande; usuário vem da sessão; coordenadas fora dos logs                                                                                                                                                                                                                   |
| **Decisões e consultas**             | `src/features/attendance/{actions,queries}.test.ts`     | Só o coordenador do posto decide (autoridade, admin, guarda-vidas, capitão negados); justificativa; colega não abre jornada alheia; painel separa validada × provisória                                                                                                                                                                     |
| **Regras do checklist**              | `src/features/checklists/rules.test.ts`                 | **Criação** (cópia só dos itens ativos), rascunho, **envio** completo/incompleto, **duplicidade** (mesmo id, id de outro checklist, reenvio após resposta perdida), **correção** com motivo, outra pessoa, linha de outro checklist, **histórico** (diferenças)                                                                             |
| **Ações do checklist**               | `src/features/checklists/actions.test.ts`               | **Permissões** (lista só pelo coordenador do posto; checklist só pelo dono), **alteração de itens** cria versão nova, início duplo, posto sem itens, colisão de pedidos repetidos                                                                                                                                                           |
| **Consultas do checklist**           | `src/features/checklists/queries.test.ts`               | Colega não abre checklist alheio; área do coordenador; problemas só de checklists enviados; filtro de situação                                                                                                                                                                                                                              |
| Checklist no banco real              | `tests/integration/checklists-db.test.ts`               | Fluxo completo; dois checklists independentes no mesmo posto e dia; **sincronização** repetida e simultânea sem duplicar; lista alterada sem mudar o checklist antigo; correção preservando a versão anterior; autor desativado continua no histórico; triggers                                                                             |
| Presença no banco real               | `tests/integration/attendance-db.test.ts`               | Online/offline, **reenvio simultâneo** sem duplicar, duplicada preservada, validação e rejeição com histórico, triggers impedem alterar/apagar o original                                                                                                                                                                                   |
| Escala no banco real                 | `tests/integration/schedules-db.test.ts`                | Fluxo completo com as ações reais: janela → disponibilidade → proposta → conflito entre postos → confirmação → alteração com justificativa → histórico; restrição única do banco                                                                                                                                                            |

### Verificação manual ponta a ponta (registrada em 2026-10-10)

Com o build de produção e PostgreSQL real, requisições HTTP com e sem
cookie confirmaram: sem cookie, cookie forjado e sessão expirada →
redirecionamento para `/login`; guarda-vidas não abre posto de outro (troca
de ID na URL) nem páginas de administração (404); administrador acessa;
guarda-vidas desativado perde o acesso imediatamente e sua sessão é apagada.
Ainda não automatizado (Playwright pendente).

### Verificação manual do checklist (registrada em 2026-10-10)

Build de produção + PostgreSQL, dados gerados pelo teste de integração e
requisições HTTP por perfil, 12 de 12 casos ok: guarda-vidas vê os seus
checklists e o formulário do próprio, recebe 404 no de uma colega, nos
problemas de materiais e na lista de itens de outro posto; coordenador vê
enviados e incompletos (com filtro), o histórico com a correção e o motivo,
e edita itens com versões; autoridade consulta itens, problemas e checklist
sem formulários de edição. **Não testado no navegador:** o envio pelos
botões e o comportamento ao perder a conexão no meio do envio (coberto
pelos testes de ação e de integração, não por navegador).

### Verificação manual da presença (registrada em 2026-10-10)

Build de produção + PostgreSQL (`prisma dev`), requisições HTTP reais, 19
de 19 casos ok: POST de outra origem (403), sem sessão (401), JSON inválido
(400), coordenador registrando (403); entrada online gravada (201) e o mesmo
registro de novo (200, sem duplicar); segunda entrada no dia (409); saída
offline (422); `/sw.js` sem cache; `Permissions-Policy` com
`geolocation=(self)`; fila de validação com formulário para o coordenador e
somente leitura para a autoridade; 404 para guarda-vidas na fila e na
jornada de um colega; painel com "Presença validada" e "Provisória".
**Não testado:** a tela em navegador real (service worker, IndexedDB, GPS,
modo avião).

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
