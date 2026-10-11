# Implicações técnicas

Como os requisitos de `PRODUCT-REQUIREMENTS.md` afetam a arquitetura da
fundação existente (Next.js 16.4, React 19.3, TypeScript strict, Tailwind 4,
Zod). Cada item indica o que é **consequência direta** de um requisito e o
que é **recomendação** sujeita a aprovação.

## Resumo

| Requisito                   | Implicação principal                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Perfis e contas individuais | Autenticação + autorização no servidor por perfil **e** posto                                 |
| Histórico com autor         | Tabela de auditoria só de inserção, escrita na mesma transação da mudança                     |
| Entrada offline + validação | PWA, armazenamento local persistente, fila de sincronização idempotente, estados de validação |
| Um turno por dia            | Restrição única no banco por pessoa e dia operacional, com fuso fixo                          |
| Alertas persistentes        | Entidade com máquina de estados; entrega por consulta periódica (polling)                     |
| Fechamento diário           | Dia operacional como entidade; dados do dia fechado protegidos                                |
| Relatórios diários          | Consultas agregadas por dia; possível snapshot no fechamento                                  |

## 1. Banco de dados — deixa de ser opcional

Todos os requisitos exigem dados persistentes e consistentes entre usuários.

- **Consequência:** adotar o PostgreSQL + Prisma previstos na stack. Fixar o
  Prisma no último estável (7.x), conforme D001.
- Integridade garantida **no banco**, não só na aplicação: chaves
  estrangeiras, restrições únicas (ex.: um turno por pessoa e dia) e
  transações.
- Ambiente local com PostgreSQL via Docker (Docker 29.8 instalado; daemon
  parado hoje).
- Backup deixa de ser "não aplicável" (veja `BACKUP-RESTORE.md`): os dados
  são registros operacionais e possivelmente de saúde.

## 2. Autenticação e autorização

- Contas individuais exigem autenticação própria; a forma depende de OD-07.
- **Autorização em duas dimensões**: perfil (autoridade, coordenador,
  guarda-vidas) e **vínculo com o posto** (o guarda-vidas só altera dados
  do seu posto e turno; o capitão tem permissões extras **no seu posto**).
- Capitão é um **atributo/atribuição** do guarda-vidas, não um perfil
  separado (requisito: "guarda-vidas com atribuições adicionais"). Se é fixo
  ou por escala depende de OD-04.
- Autoridade superior: somente leitura, aplicado no servidor (não só
  escondendo botões).
- Implementação: funções de autorização centralizadas e testadas, chamadas
  em toda Server Action e Route Handler. A biblioteca de autenticação é
  dependência nova e precisa de aprovação (OD-07).
- **Sessão e offline:** o registro offline só é possível em aparelho em que
  o usuário **já fez login com internet**. Login sem internet não é viável
  com segurança.

## 3. Histórico de alterações (auditoria)

- Tabela `audit_log` **somente inserção**: posto, autor, ação, entidade,
  identificador, data/hora do servidor, e (recomendado) valores antes/depois.
- Escrita **na mesma transação** da alteração, para não haver mudança sem
  histórico.
- Registros sincronizados do offline guardam **as duas datas**: a hora
  informada pelo aparelho e a hora de recebimento no servidor.
- Nenhuma tela ou ação permite editar ou apagar o histórico.

## 4. Tempo, turnos e dia operacional

- Fuso fixo da operação (provavelmente `America/Sao_Paulo`; confirmar em
  OD-05). Datas gravadas em UTC, "dia operacional" calculado nesse fuso.
- "Um turno por dia" vira restrição única `(guarda-vidas, dia operacional)`.
  Turnos que cruzam a meia-noite mudam essa regra (OD-05).
- **O relógio do aparelho não é confiável** (pode estar errado ou ser
  alterado). Em registros offline, a hora do aparelho é informação a ser
  validada pelo coordenador, não um fato. Isso reforça o requisito de
  validação.

## 5. Funcionamento offline

Detalhado em `OFFLINE-STRATEGY.md`. Pontos que afetam a arquitetura:

- O Next.js 16.4 tem o recurso **experimental** `experimental.useOffline`,
  que detecta perda de conexão e reenvia navegações e Server Actions. A fila
  dele fica **apenas em memória** e é perdida ao fechar a página: serve para
  a interface, **não** para guardar uma entrada registrada sem internet.
- Registro provisório exige **armazenamento persistente no aparelho**
  (IndexedDB) e uma **fila de sincronização** própria.
- Abrir o app sem internet exige **service worker** com cache da aplicação
  (PWA). A documentação do Next.js indica o Serwist para isso — dependência
  nova, precisa de aprovação.
- Sincronização **idempotente**: cada registro tem um identificador gerado
  no aparelho (UUID); reenviar o mesmo registro não pode duplicá-lo.
- Server Actions são endpoints públicos: toda sincronização valida a entrada
  com Zod e reaplica a autorização no servidor.

## 6. Alertas internos

- Entidade com estados mínimos `aberto → reconhecido → encerrado`, com
  autor e hora de cada transição no histórico. Regras de quem pode cada
  transição dependem de OD-12.
- "Persistente" significa que o alerta permanece visível até ser encerrado;
  não depende de notificação.
- **Entrega recomendada para começar: consulta periódica (polling)** na tela
  aberta. É simples e barata. Notificações push (Web Push) exigem service
  worker, chaves VAPID, permissão do usuário e têm limitações no iOS;
  avaliar depois (OD-12).
- **Alerta de reforço sem internet não chega a ninguém.** A interface deve
  deixar isso explícito. O procedimento alternativo é decisão operacional
  (OD-13), não técnica.

## 7. Fechamento diário e pendências

- O "dia operacional" por posto (ou geral — OD-15) é uma entidade com
  estado (`aberto`, `fechado`).
- Após o fechamento, alterações nos dados do dia são bloqueadas no servidor
  ou exigem fluxo de reabertura (OD-15).
- Registros offline que chegarem **depois** do fechamento são um caso a
  tratar explicitamente (OD-10).

## 8. Relatórios

- Gerados no servidor a partir dos dados do dia. Se o fechamento "congela"
  o dia, o relatório pode ser um snapshot gerado no fechamento.
- Formato (tela, PDF, CSV) depende de OD-17. PDF exige dependência nova.

## 9. Dados pessoais e segurança (LGPD)

- Ocorrências podem conter dados de vítimas, inclusive de **saúde** (dados
  sensíveis na LGPD). Isso afeta o que é coletado, quem acessa, retenção,
  logs e o que pode ficar armazenado no aparelho offline.
- Dados no IndexedDB **não são criptografados** pelo navegador e ficam
  acessíveis a quem usa o aparelho. Recomendação: guardar offline o mínimo
  necessário e apagar após sincronizar.
- Aparelhos compartilhados no posto agravam o risco (OD-20).

## 10. Testes

- Regras de negócio com estados (presença, validação, alertas, fechamento)
  são o núcleo crítico: testes unitários com Vitest.
- Autorização: testes para cada perfil × ação × posto.
- Offline: testes e2e com Playwright simulando perda de conexão
  (`context.setOffline`), além de **teste de campo em aparelhos reais**
  (Android e iOS), pois o comportamento de armazenamento varia por navegador.
- Banco: testes de integração contra PostgreSQL descartável.

## 11. Hospedagem

- Precisa de Node.js 22 e PostgreSQL gerenciado com backup.
- HTTPS é obrigatório (service worker só funciona em HTTPS).
- Polling de alertas gera tráfego constante e pequeno; dimensionar com o
  número de aparelhos (OD-20).

## Novas dependências que provavelmente serão propostas

As ainda não instaladas serão apresentadas com justificativa antes da
instalação.

| Necessidade           | Opção provável                                          | Quando                              |
| --------------------- | ------------------------------------------------------- | ----------------------------------- |
| Banco                 | `prisma`, `@prisma/client`, `@prisma/adapter-pg` 7.10.0 | **Instalado** (D005)                |
| Testes unitários      | `vitest` 5                                              | **Instalado** (D006)                |
| Testes de componentes | Testing Library + jsdom                                 | Quando houver componente com lógica |
| E2E / offline         | `@playwright/test`                                      | Fase offline                        |
| Autenticação          | depende de OD-07                                        | Fase de autenticação                |
| Senhas (se houver)    | hash forte (ex.: argon2)                                | Fase de autenticação                |
| PWA / service worker  | Serwist                                                 | Fase offline                        |
| IndexedDB             | API nativa ou wrapper pequeno (`idb`)                   | Fase offline                        |
| PDF (se exigido)      | a avaliar                                               | Fase de relatórios                  |
