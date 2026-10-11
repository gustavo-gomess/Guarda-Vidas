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
- [x] **Postos, equipes, disponibilidade e escalas**: cadastro de postos
      com situação operacional, janelas de três dias, disponibilidade,
      montagem manual, confirmação, alteração com justificativa, filtros e
      histórico. Regras provisórias OD-03, OD-08, OD-24 a OD-27.
- [x] **Presença e jornada**: entrada/saída, entrada offline com fila no
      aparelho e service worker, sincronização idempotente, GPS e relógio
      como indícios, fila de validação, painel validada × provisória,
      registros e decisões imutáveis. Saída offline pendente (OD-10).
      Regras provisórias OD-28 a OD-31.
- [x] **Checklist individual e materiais**: lista de itens por posto com
      versões, um checklist por assunção, rascunho/envio/correção com
      motivo, histórico de versões, problemas de materiais para a
      coordenação, envio repetido sem duplicar. Só online (OD-35).
      Regras provisórias OD-06, OD-32 a OD-35.
- [x] **Registros operacionais e alerta de reforço**: categorias com campos
      configuráveis e versões, registros do posto com anulação; alerta do
      capitão com estados, ações da coordenação, histórico, aviso interno
      por consulta periódica, falhas de envio explícitas. Regras
      provisórias OD-36 a OD-40.

## Pendente da etapa de requisitos

- [x] `OPEN-DECISIONS.md` — dúvidas de produto (`OD-xx`).
- [x] `OFFLINE-STRATEGY.md` — matriz proposta (pendente de aprovação,
      OD-18) e fluxo offline da presença.
- [ ] `IMPLEMENTATION-PLAN.md` — ordem de execução dos módulos.
- [ ] Confirmar as decisões provisórias de autenticação (OD-01, 02, 04,
      07, 21, 22, 23).
- [ ] Confirmar as decisões provisórias de escalas (OD-03, 08, 24 a 27).
- [ ] Decidir a saída sem internet (OD-10) e confirmar OD-28 a OD-31.
- [ ] Testar a presença offline em aparelhos reais (Android e iOS).
- [ ] Confirmar OD-06 e OD-32 a OD-35 (checklist), inclusive se o
      checklist deve funcionar offline.
- [ ] Definir o canal oficial de emergência exibido quando o alerta não é
      enviado (OD-13), quem além do capitão envia (OD-36) e as categorias
      oficiais de registro (OD-11, OD-39).

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

- [x] Commits das etapas de padronização, requisitos, fundação e
      autenticação (`d618768`, `45dbe83`).
- [ ] Primeiro push para o GitHub (aguardando aprovação).
- [ ] Conferir se o e-mail do Git local corresponde à conta GitHub.
- [ ] Docker Desktop não inicia nesta máquina ("unable to start"; a VM do
      WSL 2 não sobe). Necessário para o banco local do `docker-compose.yml`.
- [ ] Mover o repositório para fora do OneDrive (recomendado).
