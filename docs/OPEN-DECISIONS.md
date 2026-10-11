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

- O pedido (Prompt 3) fala em "identificador, nome, localização, estado
  operacional e dados necessários ao serviço", sem detalhar.
- **Provisória (implementada):** identificador curto único (ex.: `P-01`,
  maiúsculas), nome único, localização em texto livre, "informações para o
  serviço" em texto livre e situação com três valores: **em operação**,
  **fora de operação temporariamente** e **desativado**. Só posto em
  operação recebe escala; desativado não recebe equipe nova. O
  administrador cadastra e edita; a situação também pode ser mudada pelo
  coordenador do posto.
- Postos existentes antes da mudança receberam um identificador gerado
  (`P-` + início do id), que o administrador pode trocar.
- Pendente: campos estruturados (faixa de praia, horário de funcionamento,
  temporada, materiais fixos) e os valores definitivos da situação.

### OD-04 — Capitão do posto

- Perguntas: como é designado? Fixo ou por dia/escala? Pode haver mais de
  um por posto? Quais atribuições além do alerta de reforço?
- **Provisória (implementada):** atribuição de um guarda-vidas vinculado ao
  posto, definida pelo coordenador do posto ou administrador; **no máximo um
  capitão por posto** (escolher outro retira o anterior, com histórico).
  Único poder extra hoje: `canActAsCaptain` (usado pelo futuro alerta de
  reforço).
- Impacto de "capitão por escala": o vínculo passa a ser por dia, no módulo
  de escalas. **O módulo de escalas foi feito sem isso:** o capitão continua
  fixo por posto.

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
- **Já usado provisoriamente:** o dia operacional das janelas e escalas é o
  calendário de `America/Sao_Paulo` (`src/lib/dates.ts`). A escala é por
  dia inteiro, sem horário.

### OD-06 — Checklist na assunção

- O que é "assunção" (início do turno? cada troca de posto?); itens; quem
  define; varia por posto; efeito de item reprovado.

### OD-08 — Disponibilidade em janelas de três dias

- Definido no pedido (Prompt 3): o coordenador abre janelas de três dias
  consecutivos; cada guarda-vidas registra a própria disponibilidade; a
  coordenação visualiza; a escala é montada à parte e confirmada pelo
  coordenador. Disponibilidade nunca vira escala sozinha.
- **Provisória (implementada):**
  - a janela é **única para todos os postos** (a disponibilidade é da
    pessoa, não do posto) e **qualquer coordenador** abre, encerra ou
    reabre;
  - começa hoje ou depois; **janelas não se sobrepõem**; janelas seguidas
    são permitidas;
  - não há prazo automático: a janela fica aberta até um coordenador
    encerrá-la; enquanto aberta, o guarda-vidas pode alterar a resposta;
  - a resposta é sim/não para cada um dos três dias, com observação
    opcional; quem não respondeu aparece como "não enviou".
- Pendente: prazo de envio, lembretes, janela por região/posto.

### OD-24 — Sugestão automática de escala

- O pedido diz "caso isso tenha sido aprovado nos requisitos". **Não foi.**
- **Não implementada.** A escala é montada só manualmente. Se aprovada, a
  sugestão deve gerar uma **proposta** (nunca confirmada automaticamente) e
  precisa de critérios: rodízio, folgas, número mínimo por posto,
  preferência de posto.

### OD-25 — Justificativas e dias passados na escala

- O pedido pede "justificativa quando necessária", sem dizer quando.
- **Provisória (implementada):** justificativa (mínimo de 5 caracteres) é
  obrigatória para:
  - incluir ou retirar alguém de uma escala **já confirmada** (a escala
    passa a "alterada após confirmação");
  - escalar quem **não declarou disponibilidade** para o dia (indisponível
    ou não enviou). O coordenador pode fazer isso, mas fica registrado.
- Dias que **já passaram** não podem ser alterados na escala.
- Pendente: se alterar escala confirmada deve avisar o guarda-vidas, e se
  dias passados precisam de correção (por quem).

### OD-26 — Quem pode ser escalado em um posto

- **Provisória (implementada):** só guarda-vidas **ativos da equipe do
  posto**. Para escalar alguém de fora, o coordenador primeiro o adiciona à
  equipe. Um guarda-vidas fica em **um posto por dia** (regra aprovada de um
  turno por dia + "nunca dois postos simultaneamente"), em qualquer estado
  de escala: uma proposta já "reserva" a pessoa naquele dia.
- Não há número mínimo ou máximo de guarda-vidas por posto e dia.
- Retirar alguém da equipe ou desativá-lo **não** apaga escalas já feitas;
  a página da escala mostra "(inativo)".
- Pendente: efetivo mínimo por posto; reforço vindo de outra equipe; turnos
  menores que um dia (depende de OD-05).

### OD-27 — Quem consulta a escala

- **Provisória (implementada):**
  - guarda-vidas: **só os próprios dias**, e só de escalas confirmadas ou
    alteradas; não vê propostas nem a escala dos colegas;
  - coordenador: escalas e disponibilidade dos postos da sua área, em
    qualquer estado; só ele monta, confirma e altera;
  - autoridade superior e administradores: consultam tudo, inclusive
    propostas, **sem editar** (ser administrador não dá poder sobre escala).
- Pendente: o guarda-vidas deve ver quem mais está escalado no seu posto?

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
