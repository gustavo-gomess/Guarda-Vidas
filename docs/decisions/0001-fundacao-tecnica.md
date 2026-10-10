# 0001 — Fundação técnica

- Status: aceita
- Data: 2026-10-10

## Contexto

Projeto iniciado do zero. As versões "latest" do npm em 2026-10-10 não eram
todas compatíveis entre si.

## Decisões

1. **Base gerada com `create-next-app@16.4.0`** (App Router, `src/`, Tailwind,
   ESLint, alias `@/*`), mantendo os defaults do template (`cacheComponents`,
   `partialPrefetching`, `@tailwindcss/turbopack`).
2. **TypeScript 5.x, não 7.x.** `typescript-eslint` 8.71 exige
   `typescript <6.1.0`; o template oficial do Next 16.4 usa `^5`.
3. **ESLint 9, não 10.** `eslint-plugin-react`, `eslint-plugin-import` e
   `eslint-plugin-jsx-a11y` (dependências de `eslint-config-next`) ainda não
   declaram suporte ao ESLint 10. O npm marca o ESLint 9 como sem suporte;
   reavaliar quando os plugins forem atualizados.
4. **Prisma fixado em versão estável** quando for adotado: a dist-tag `latest`
   apontava para `8.0.0-rc.22`.
5. **Node 22 LTS** (`.nvmrc`, `engines`).
6. **Prettier** com `prettier-plugin-tailwindcss`; `eslint-config-prettier`
   desliga regras de estilo conflitantes no ESLint.
7. **Variáveis de ambiente validadas com Zod** em `src/env.ts`, carregado em
   `src/instrumentation.ts` para falhar no start do servidor.
8. **TypeScript mais estrito**: `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`.

## Riscos aceitos

- `npm audit` reporta 5 vulnerabilidades altas, todas de uma única cadeia
  (DoS por padrões aninhados no `braces`):
  - `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` →
    `micromatch` → `braces@3.0.3`
- Não há versão corrigida de
  `braces` publicada; a "correção" do `npm audit fix --force` rebaixaria para
  Next 14. Afeta só a ferramenta de lint em desenvolvimento, não o bundle de
  produção. Reavaliar a cada atualização do `eslint-config-next`.
