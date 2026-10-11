# Convenções

Regras para manter o código consistente. Quando uma convenção atrapalhar um
caso real, discuta e registre a exceção em `DECISIONS.md`. Não ignore em
silêncio.

## Nomenclatura

| Item                          | Padrão                        | Exemplo                     |
| ----------------------------- | ----------------------------- | --------------------------- |
| Arquivos e pastas             | `kebab-case`                  | `shift-schedule.tsx`        |
| Arquivos especiais do Next.js | nome exigido pelo framework   | `page.tsx`, `error.tsx`     |
| Componentes React             | `PascalCase`                  | `export function ShiftCard` |
| Funções e variáveis           | `camelCase`                   | `calculateShiftHours`       |
| Constantes globais            | `SCREAMING_SNAKE_CASE`        | `MAX_SHIFT_HOURS`           |
| Tipos e interfaces            | `PascalCase`, sem prefixo `I` | `type Shift`                |
| Schemas Zod                   | `camelCase` + sufixo `Schema` | `shiftSchema`               |
| Testes unitários              | mesmo nome + `.test.ts(x)`    | `rules.test.ts`             |
| Testes e2e                    | `*.spec.ts` em `e2e/`         | `e2e/login.spec.ts`         |

Nomes de código em **inglês**. Textos exibidos ao usuário em **português
(pt-BR)**.

## Imports

- Use o alias `@/` para tudo em `src/`; caminhos relativos só dentro da mesma
  pasta (`./schemas`).
- Ordem, separada por uma linha em branco:
  1. Diretivas (`"use client"`, `"use server"`, `import "server-only"`).
  2. Pacotes externos (`react`, `next/*`, `zod`).
  3. Imports internos (`@/...`).
  4. Imports relativos (`./...`).
  5. Estilos.
- Use `import type` para importar somente tipos.
- Sem barrel files (`index.ts` reexportando tudo); importe do arquivo real.

## Componentes React

- Componentes de função com `export function Nome()`. Use export nomeado,
  exceto onde o Next.js exige `export default` (`page`, `layout`, `error`, …).
- Props tipadas com `type NomeProps = { ... }` no mesmo arquivo.
- Um componente público por arquivo; subcomponentes pequenos e privados podem
  ficar no mesmo arquivo.
- Estilo com classes Tailwind; a ordem é mantida pelo
  `prettier-plugin-tailwindcss`.
- Acessibilidade: elementos semânticos, `label` em campos, `alt` em imagens.
  O ESLint (`jsx-a11y`) aponta parte dos problemas.

## Server Components e Client Components

- **Server Component por padrão.** Adicione `"use client"` apenas quando
  precisar de estado, efeitos, eventos do navegador ou APIs do browser.
- Mantenha `"use client"` nas folhas da árvore; não marque layouts ou páginas
  inteiras como client para usar um único botão.
- Nunca importe em um Client Component módulos com `import "server-only"`,
  segredos ou acesso a banco.
- Mutações usam **Server Actions** (`"use server"`) ou Route Handlers. As duas
  são endpoints públicos: valide a entrada e verifique autorização dentro
  delas.
- Com `cacheComponents` ativo, dados são dinâmicos por padrão. Use
  `"use cache"` conscientemente e envolva conteúdo dinâmico em `<Suspense>`.

## Tratamento de erros

- **Erros esperados** (validação, regra de negócio, recurso inexistente) são
  modelados como **valores de retorno**, não exceções. Use `ActionResult` e
  os helpers de `@/lib/errors`:
  ```ts
  "use server";
  import { fail, invalidInput, ok, type ActionResult } from "@/lib/errors";

  export async function createThing(
    formData: FormData,
  ): Promise<ActionResult<{ id: string }>> {
    const parsed = thingSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return invalidInput(parsed.error);
    // ...autorização, regra de negócio
    if (conflict) return fail("Já existe um registro para hoje.");
    return ok({ id });
  }
  ```
- Recurso inexistente em páginas: `notFound()` de `next/navigation`.
- **Erros inesperados** são lançados (com contexto) e capturados por
  `error.tsx` no segmento de rota; `global-error.tsx` para o layout raiz. No
  servidor, `onRequestError` (`src/instrumentation.ts`) registra o erro no
  log. A tela mostra só o `digest`, que liga o erro ao log.
- Mensagens ao usuário são genéricas e em pt-BR; detalhes técnicos vão só
  para o log do servidor.
- Não use `catch` vazio; ou trate, ou relance com contexto.

## Autorização

Regra: **nada sensível é protegido só pela interface.** Esconder um botão é
conveniência; a proteção está no servidor.

- **Server Action:** sempre nesta ordem:
  1. `const actor = await requireActor();` (redireciona se não houver
     sessão ou se a senha temporária ainda não foi trocada);
  2. validar o `FormData` com Zod (IDs como `z.uuid()`);
  3. checar a política com os IDs **recebidos**
     (`canManagePostTeam(actor, postId)`), e não com o que a tela mostrou;
  4. negar com `fail(...)` e `logger.warn("authz.denied", {...})` **antes**
     de tocar no banco;
  5. alterar dentro de `db.$transaction` com `recordAudit(tx, ...)`.
- **Consultas** (`queries.ts`, `server-only`) recebem o `Actor` e aplicam a
  política elas mesmas; retornam `null` quando negado. Nunca exporte uma
  função que receba um `userId`/`postId` "de confiança" sem o `Actor`.
- **Páginas** leem a sessão dentro de `<Suspense>` e chamam `notFound()`
  quando negado: recurso inexistente e proibido têm a mesma resposta.
- Nunca use perfil, usuário ou posto vindos do navegador como identidade;
  a identidade é sempre `actor.id`.
- Nunca selecione `passwordHash`, `failedLoginAttempts` ou `lockedUntil`
  fora de `src/lib/auth/`.
- Toda nova regra de permissão entra em `src/lib/auth/policy.ts` com teste
  para cada perfil, incluindo o caso de acesso negado e de outro posto ou
  usuário.

## Validação

- Toda entrada externa é validada com Zod na fronteira: `FormData`, params,
  search params, corpo de Route Handlers, webhooks, respostas de APIs
  externas, variáveis de ambiente.
- Use `safeParse` e converta falhas em `ActionResult` com
  `z.flattenError(error).fieldErrors`.
- Derive tipos dos schemas (`z.infer<typeof schema>`) em vez de duplicá-los.
- Validação no cliente é só conveniência de UX; a validação do servidor é a
  que vale.

## Tipagem

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` e
  `noFallthroughCasesInSwitch` estão ativos e não devem ser desligados.
- Sem `any`. Se for inevitável, use `unknown` e estreite; se ainda assim
  precisar de `any`, comente o motivo.
- Evite asserções (`as`) e non-null (`!`); prefira narrowing e validação.
- Use `type` por padrão; `interface` só quando precisar de declaration
  merging.
- Funções exportadas têm tipos de retorno explícitos quando o retorno não for
  óbvio.

## Logs

- Logs apenas no servidor, com `logger` de `@/lib/logger`. O ESLint
  proíbe `console` fora de `src/lib/logger-core.ts`.
- Formato: mensagem curta e **fixa** + objeto de contexto:
  `logger.error("shift.create failed", { shiftId, error })`.
  Em produção sai uma linha JSON (`time`, `level`, `msg`, contexto); em
  desenvolvimento, texto legível.
- O contexto passa por ocultação automática: chaves como `password`,
  `senha`, `token`, `authorization`, `cookie`, `apiKey`, `cpf`, `email`,
  `phone` viram `[REDACTED]`. **A mensagem não é filtrada**: nunca
  interpole dados do usuário nela.
- A ocultação é uma rede de segurança, não um filtro completo: nomes livres
  como `vitima` ou `observacao` não são reconhecidos. Registre
  identificadores, nunca conteúdo de ocorrências ou dados de saúde.
- Erros: passe o objeto em `{ error }`; o logger serializa nome, mensagem,
  `code`, `digest` e (fora de produção) o stack. Mensagens de erro de
  bibliotecas podem conter valores; evite logar erros de validação inteiros.
- Queries do banco não são logadas.
- Níveis: `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; padrão `info`).

## Variáveis de ambiente

- Declare toda variável em `src/lib/env-schema.ts` (schema Zod) e documente
  em `.env.example` com um valor de exemplo seguro.
- Leia sempre via `getEnv()` de `@/env`, dentro de funções (não no topo do
  módulo), para que o build não exija segredos. O ESLint bloqueia
  `process.env` fora de `src/env.ts`, `src/instrumentation.ts`,
  `next.config.ts` e `prisma7.config.ts`.
- `NEXT_PUBLIC_` apenas para valores que podem ser públicos; eles vão para o
  bundle do navegador. Variáveis públicas, quando existirem, terão um schema
  separado no mesmo arquivo.
- Valores reais ficam em `.env.local` (ignorado pelo Git) ou no painel da
  hospedagem.

## Commits e branches

- **Conventional Commits**: `tipo(escopo opcional): descrição no imperativo`.
  Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`,
  `build`. Exemplo: `feat(shifts): add shift creation form`.
- Commits pequenos e focados; cada commit deve passar em lint e typecheck.
- `main` é a branch estável. Trabalho em branches curtas:
  `feat/<assunto>`, `fix/<assunto>`, `chore/<assunto>`, `docs/<assunto>`.
- Integração via Pull Request quando o CI existir; sem force-push em `main`.

## Documentação de novas funcionalidades

Ao concluir uma funcionalidade:

1. Atualize `ARCHITECTURE.md` se criar diretórios, camadas ou integrações.
2. Registre em `DECISIONS.md` escolhas técnicas não óbvias (nova dependência,
   trade-off, exceção a uma convenção).
3. Atualize `.env.example` e `DEVELOPMENT.md` se houver nova variável ou
   passo de setup.
4. Atualize `TESTING.md` se criar um novo tipo de teste ou fixture.
5. Atualize `ROADMAP.md` marcando o item como concluído.
