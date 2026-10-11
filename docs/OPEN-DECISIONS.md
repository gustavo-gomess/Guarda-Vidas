# Decisões em aberto

Dúvidas de **produto** que o responsável precisa decidir. Cada item traz
opções, uma recomendação e o impacto. Status:

- **Pendente**: nada foi implementado a respeito.
- **Provisória (implementada)**: o código segue a recomendação para não
  bloquear o trabalho; mudar é possível e o custo está indicado.

Decisões técnicas já tomadas ficam em `DECISIONS.md`.

## Perfis e permissões

### OD-01 — A autoridade superior edita alguma coisa?

- Requisito: "consulta, sem edição operacional comum".
- Opções: (a) somente leitura total; (b) leitura + ações excepcionais
  (ex.: reabrir dia fechado, encerrar alerta crítico).
- Recomendação: (a) até surgir um caso concreto.
- **Provisória (implementada):** somente leitura de todos os postos e
  usuários. Pode receber a atribuição de administrador (gestão de contas,
  não operação).

### OD-02 — Qual é a área de responsabilidade do coordenador?

- Opções: (a) lista de postos atribuídos a ele; (b) região que agrupa
  postos; (c) todos os postos.
- Recomendação: (a); se surgirem regiões, elas podem agrupar postos depois.
- **Provisória (implementada):** (a). O administrador define os postos de
  cada coordenador.
- Impacto de mudar para (b): nova entidade "região" e migração simples.

### OD-03 — Atributos do posto

- Hoje o posto tem só nome e situação (ativo/inativo).
- Pendente: localização, faixa de praia, horário de funcionamento,
  temporada, materiais fixos.

### OD-04 — Capitão do posto

- Perguntas: como é designado? Fixo ou por dia/escala? Pode haver mais de
  um por posto? Quais atribuições além do alerta de reforço?
- **Provisória (implementada):** atribuição de um guarda-vidas vinculado ao
  posto, definida pelo coordenador do posto ou administrador; **no máximo um
  capitão por posto** (escolher outro retira o anterior, com histórico).
  Único poder extra hoje: `canActAsCaptain` (usado pelo futuro alerta de
  reforço).
- Impacto de "capitão por escala": o vínculo passa a ser por dia, no módulo
  de escalas.

### OD-21 — Quem administra usuários?

- O requisito pede "administração controlada", sem dizer por quem.
- Opções: (a) atribuição `isAdmin` dada a coordenadores ou autoridades;
  (b) coordenadores criam contas dos guarda-vidas da sua área.
- **Provisória (implementada):** (a). Administrador cria e desativa contas,
  muda perfis, redefine senhas, cria postos e define áreas de coordenação.
  Coordenadores gerenciam só **equipe e capitão** dos seus postos.
  Guarda-vidas não pode ser administrador. Ninguém altera o próprio perfil,
  acesso de administrador ou situação, e sempre resta pelo menos um
  administrador ativo.

## Autenticação

### OD-07 — Forma de login e criação de contas

- Opções: (a) usuário + senha (ex.: matrícula); (b) e-mail + senha;
  (c) CPF; (d) provedor externo (Google/Microsoft).
- Recomendação: (a). Não depende de e-mail, funciona para quem não tem
  e-mail institucional e não expõe CPF.
- **Provisória (implementada):** (a), com usuário de 3 a 50 caracteres
  (letras sem acento, números, `.`, `-`, `_`). Contas criadas pelo
  administrador com senha temporária e troca obrigatória no primeiro acesso.

### OD-22 — Duração da sessão e bloqueio por tentativas

- Tensão: sessões longas facilitam o uso em campo e o futuro registro
  offline (exige login prévio); sessões curtas reduzem o risco de aparelho
  perdido ou compartilhado.
- **Provisória (implementada):** expira após **7 dias sem uso** e, no
  máximo, **30 dias** após o login; **5 senhas erradas** seguidas bloqueiam a
  conta por **15 minutos**. Valores em `src/lib/auth/auth-service.ts`.
- Depende de OD-20 (aparelhos pessoais ou compartilhados).

### OD-23 — Recuperação de senha

- O requisito diz "caso aprovada". Não foi aprovada.
- Opções: (a) só redefinição pelo administrador; (b) recuperação por e-mail
  (exige e-mail cadastrado e serviço de envio); (c) por SMS.
- **Provisória (implementada):** (a). O administrador gera uma senha
  temporária (mostrada uma vez) e todas as sessões do usuário são
  encerradas. Administradores sem acesso são recuperados pela linha de
  comando (`npm run admin -- reset-password`).

## Operação (pendentes)

### OD-05 — Turno e jornada

- Horários permitidos; turno que cruza a meia-noite; esquecimento de saída;
  quem corrige; fuso (provável `America/Sao_Paulo`).

### OD-06 — Checklist na assunção

- O que é "assunção" (início do turno? cada troca de posto?); itens; quem
  define; varia por posto; efeito de item reprovado.

### OD-08 — Disponibilidade em janelas de três dias

- Quem informa a disponibilidade; janela fixa ou móvel; prazo; como vira
  escala.

### OD-09 — Entrada offline: evidências

- Hora do aparelho basta? Exigir foto/localização? (afeta LGPD).

### OD-10 — Entrada offline: validação

- Prazo para sincronizar e validar; efeito de rejeição; chegada depois do
  fechamento do dia; saída também offline?

### OD-11 — Materiais, ocorrências e registros do posto

- Tipos e campos de cada um; inventário ou consumo; dados de vítimas.

### OD-12 — Alertas internos

- Tipos, destinatários, quem reconhece e encerra, notificação fora do app
  (push).

### OD-13 — Alerta de reforço

- Destinatários; fluxo; procedimento quando o capitão está sem internet.

### OD-14 — Pendências

- O que gera uma pendência; quem resolve.

### OD-15 — Fechamento diário

- Por posto ou geral; pendências bloqueiam; o que fica travado; reabertura.

### OD-16 — Histórico de alterações

- Implementado para contas, postos e vínculos (antes/depois, autor, data,
  posto; banco impede alteração). Pendente: retenção e quem consulta o
  histórico operacional.

### OD-17 — Relatórios diários

- Conteúdo, formato (tela, PDF, planilha), destinatários.

### OD-18 — Matriz offline por funcionalidade

- A ser proposta em `OFFLINE-STRATEGY.md` (ainda não escrito).

### OD-19 — Dados pessoais (LGPD)

- Quais dados de vítimas são coletados; retenção; base legal; quem acessa.

### OD-20 — Volume e aparelhos

- Número de postos, usuários e aparelhos; aparelhos pessoais ou do posto
  (compartilhados); Android/iOS.
