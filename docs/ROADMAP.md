# Roadmap

Fases do projeto. Módulos de negócio só começam depois que a fundação
estiver concluída e as decisões de produto bloqueantes, aprovadas.

## Concluído

- [x] **Auditoria técnica** do repositório e do ambiente.
- [x] **Esqueleto da aplicação**: Next.js 16.4, React 19.3, TypeScript strict,
      Tailwind 4, ESLint 9, Prettier, Zod.
- [x] **Padronização**: `CLAUDE.md`, permissões do Claude Code, estrutura,
      convenções e documentação em `docs/`.
- [x] **Requisitos (parcial)**: `PRODUCT-REQUIREMENTS.md` e
      `TECHNICAL-IMPLICATIONS.md`.
- [x] **Fundação técnica**: PostgreSQL + Prisma 7.10 (sem modelos),
      migrações, validação de ambiente com falha no start, `ActionResult`,
      páginas de erro, `onRequestError`, logger com ocultação, Vitest,
      headers de segurança, `/api/health`, ESLint impondo `no-console` e
      `getEnv()`.

- [x] **Autenticação e permissões**: contas individuais, login/logout,
      sessões no banco, senhas `scrypt`, bloqueio por tentativas, perfis
      (autoridade, coordenador, guarda-vidas), capitão e administrador como
      atribuições, postos e áreas de coordenação, auditoria imutável,
      script do primeiro administrador. Regras provisórias em
      `OPEN-DECISIONS.md`.

## Pendente da etapa de requisitos

- [x] `OPEN-DECISIONS.md` — dúvidas de produto (`OD-xx`).
- [ ] `OFFLINE-STRATEGY.md` — matriz offline por funcionalidade.
- [ ] `IMPLEMENTATION-PLAN.md` — ordem de execução dos módulos.
- [ ] Confirmar as decisões provisórias de autenticação (OD-01, 02, 04,
      07, 21, 22, 23).

## Próximas fases técnicas

- [ ] **CI**: GitHub Actions com `npm ci`, format, lint, typecheck,
      `test:run` e build em todo push/PR; proteção da branch `main`;
      Dependabot.
- [ ] **Playwright** automatizando a verificação ponta a ponta de
      autenticação já feita manualmente.
- [ ] **Offline**: PWA, armazenamento local, fila de sincronização,
      Playwright (depende da matriz offline aprovada).
- [ ] **Segurança**: Content-Security-Policy.
- [ ] **Deploy**: escolha de hospedagem, ambientes, segredos, backup.

## Pendências operacionais

- [ ] Commits das etapas de padronização, requisitos e fundação (aguardando
      aprovação).
- [ ] Primeiro push para o GitHub (aguardando aprovação).
- [ ] Conferir se o e-mail do Git local corresponde à conta GitHub.
- [ ] Docker Desktop não inicia nesta máquina ("unable to start"; a VM do
      WSL 2 não sobe). Necessário para o banco local do `docker-compose.yml`.
- [ ] Mover o repositório para fora do OneDrive (recomendado).
