# Guarda-Vidas

Aplicação web em Next.js (App Router), React, TypeScript strict e Tailwind CSS.

## Requisitos

- Node.js 22 (veja `.nvmrc`)
- npm 10+

## Como rodar

```bash
npm ci
cp .env.example .env.local   # preencha os valores, se houver
npm run dev
```

A aplicação fica em http://localhost:3000.

## Scripts

| Comando                | O que faz                              |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | Servidor de desenvolvimento            |
| `npm run build`        | Build de produção                      |
| `npm run start`        | Sobe o build de produção               |
| `npm run lint`         | ESLint                                 |
| `npm run typecheck`    | Gera tipos de rotas e roda `tsc`       |
| `npm run format`       | Formata o código com Prettier          |
| `npm run format:check` | Verifica a formatação sem alterar nada |

## Variáveis de ambiente

Toda variável deve ser declarada em `src/env.ts` (validada com Zod na
inicialização) e documentada em `.env.example`. Arquivos `.env*` reais nunca
são commitados.

## Documentação

- `CLAUDE.md` — regras de engenharia do projeto.
- `docs/` — arquitetura e decisões técnicas.
