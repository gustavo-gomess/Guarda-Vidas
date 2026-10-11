# Requisitos do produto

> Sistema de gestão de postos de guarda-vidas.
> Estado em 2026-10-10. Implementados: contas e permissões (RF-01),
> jornada e presença (RF-02), entrada sem internet (RF-03), checklist
> individual (RF-04), problemas de materiais no checklist (parte do RF-05),
> ocorrências e registros do posto em categorias configuráveis (RF-06,
> RF-07), alerta de reforço (parte do RF-09) e equipes, disponibilidade e
> escalas (RF-08), com regras provisórias.
>
> Este documento lista apenas requisitos **fornecidos pelo responsável pelo
> produto**. Tudo o que não foi informado está marcado como dúvida e
> detalhado em `OPEN-DECISIONS.md` (referências `OD-xx`). Não implemente
> regras que não estejam aqui ou aprovadas lá.

## Objetivo

Apoiar a operação diária dos postos de guarda-vidas, com confiabilidade
operacional, segurança, simplicidade e baixo custo de manutenção.

## Glossário

| Termo                     | Significado confirmado                                            | Em aberto                     |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Posto                     | Local de atuação dos guarda-vidas, ao qual o histórico se vincula | Atributos do posto — OD-03    |
| Turno / jornada           | Um turno por dia, com entrada e saída                             | Limites de horário — OD-05    |
| Assunção                  | Momento em que o guarda-vidas assume; exige checklist individual  | Definição exata — OD-06       |
| Janela de disponibilidade | Período de três dias usado pelo coordenador                       | Mecânica da janela — OD-08    |
| Fechamento diário         | Ação do coordenador que encerra o dia operacional                 | Efeitos e reabertura — OD-15  |
| Pendência                 | Item que o coordenador acompanha                                  | O que gera pendência — OD-14  |
| Alerta interno            | Aviso persistente com reconhecimento e encerramento               | Tipos e destinatários — OD-12 |
| Alerta de reforço         | Alerta gerado pelo capitão do posto                               | Fluxo e destinatários — OD-13 |

## Perfis de acesso

| Perfil              | Requisito aprovado                                                                                                                            | Em aberto                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Autoridade superior | **Consulta.** Sem edição operacional comum.                                                                                                   | Existe alguma edição excepcional? — OD-01      |
| Coordenador         | Gerencia equipes, disponibilidade em janelas de três dias, escalas, pendências e fechamento diário. Valida entradas registradas sem internet. | Abrangência (todos os postos ou parte) — OD-02 |
| Guarda-vidas        | Conta individual. Registra presença, checklist, materiais, ocorrências e registros do posto.                                                  | —                                              |
| Capitão do posto    | É um guarda-vidas com atribuições operacionais adicionais, inclusive gerar alertas de reforço.                                                | Como é designado; demais atribuições — OD-04   |

Autorização é verificada **no servidor** para cada ação, considerando perfil
e posto (regra do `CLAUDE.md`).

## Requisitos funcionais

### RF-01 — Contas individuais

- Cada guarda-vidas tem conta própria; registros identificam a pessoa.
- Em aberto: forma de login e criação de contas — OD-07.

### RF-02 — Jornada e presença

- Um turno por dia, com registro de **entrada** e **saída**.
- Em aberto: horários permitidos, turno que cruza a meia-noite, esquecimento
  de saída, quem corrige — OD-05.

### RF-03 — Entrada sem internet

- Sem internet, a entrada é registrada **localmente como provisória**.
- É **sincronizada** quando a conexão voltar.
- Precisa de **validação do coordenador**.
- Em aberto: o que acontece em caso de rejeição, prazos, evidências exigidas,
  saída também offline — OD-09, OD-10.

### RF-04 — Checklist individual

- Cada guarda-vidas preenche um checklist **a cada assunção**.
- Em aberto: itens, quem os define, se varia por posto, efeito de item
  reprovado — OD-06.

### RF-05 — Materiais

- O guarda-vidas registra informações de materiais.
- Em aberto: se é inventário do posto, consumo, avaria ou empréstimo — OD-11.

### RF-06 — Ocorrências

- O guarda-vidas registra ocorrências.
- Em aberto: tipos, campos, dados de vítimas (dados pessoais e de saúde) —
  OD-11, OD-19.

### RF-07 — Registros do posto

- O guarda-vidas registra informações do posto.
- Em aberto: que tipos de registro (condições do mar, bandeira, público,
  livro de ocorrências do posto…) — OD-11.

### RF-08 — Equipes, disponibilidade e escalas (coordenador)

- O coordenador gerencia equipes.
- Gerencia a disponibilidade em **janelas de três dias**.
- Gerencia escalas.
- Detalhado no Prompt 3: janelas de três dias abertas pelo coordenador;
  cada guarda-vidas envia a própria disponibilidade; montagem manual;
  confirmação sempre pelo coordenador; estados separados (disponibilidade
  enviada, escala proposta, confirmada, alterada); histórico com
  justificativa; nunca dois postos ao mesmo tempo.
- Em aberto: prazo da janela, sugestão automática, efetivo mínimo,
  visibilidade da escala dos colegas — OD-08, OD-24 a OD-27.

### RF-09 — Alertas internos

- Alertas são **persistentes** (não somem sozinhos).
- Têm **reconhecimento** e **encerramento**.
- O capitão do posto pode gerar **alertas de reforço**.
- Em aberto: tipos, destinatários, quem reconhece e encerra, notificação
  fora do app — OD-12, OD-13.

### RF-10 — Pendências e fechamento diário

- O coordenador gerencia pendências e faz o fechamento diário.
- Em aberto: o que gera pendência, se pendências bloqueiam o fechamento, o
  que o fechamento trava, se pode ser reaberto — OD-14, OD-15.

### RF-11 — Histórico de alterações

- Toda alteração fica no histórico **vinculado ao posto**, **identificando o
  autor**.
- Em aberto: nível de detalhe (antes/depois), retenção, quem consulta —
  OD-16.

### RF-12 — Relatórios operacionais diários

- O sistema gera relatórios operacionais diários.
- Em aberto: conteúdo, formato (tela, PDF, planilha), destinatários — OD-17.

### RF-13 — Funcionamento offline

- O funcionamento offline é **avaliado individualmente por funcionalidade**.
- Proposta de matriz em `OFFLINE-STRATEGY.md`, pendente de aprovação — OD-18.

## Requisitos não funcionais

| Requisito                                       | Origem                             |
| ----------------------------------------------- | ---------------------------------- |
| Confiabilidade operacional                      | Aprovado                           |
| Segurança                                       | Aprovado                           |
| Simplicidade e baixo custo de manutenção        | Aprovado                           |
| Hospedagem simples e de baixo custo             | Aprovado (fase anterior)           |
| Interface em português (pt-BR)                  | Convenção do projeto               |
| Uso em celular na praia, com sol e conexão ruim | **Suposição** — confirmar em OD-20 |
| Volume (postos, usuários, aparelhos)            | Desconhecido — OD-20               |
| Conformidade com a LGPD                         | Provável — OD-19                   |

## Fora do escopo até decisão contrária

- Integrações externas (sistemas oficiais, rádio, SMS, WhatsApp).
- Geolocalização ou fotos **como prova** de presença. A localização é
  registrada quando disponível, como indício para o coordenador (Prompt 4,
  OD-09); fotos não.
- Aplicativo nativo de loja (a proposta é web/PWA).
