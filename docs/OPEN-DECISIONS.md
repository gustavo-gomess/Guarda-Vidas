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
- **Presença (provisório):** sem limite de horário; uma jornada por dia
  operacional; a saída precisa ser no **mesmo dia** da entrada (turno que
  cruza a meia-noite não é suportado). Saída esquecida: a jornada fica sem
  saída; nada é fechado automaticamente. Correção da saída: pendente.

### OD-06 — Checklist na assunção

- O que é "assunção" (início do turno? cada troca de posto?); itens; quem
  define; varia por posto; efeito de item reprovado.
- Definido no Prompt 5: cada assunção gera um checklist próprio, ligado à
  assunção, ao guarda-vidas, ao posto e à jornada.
- **Provisória (implementada):** assunção = a **jornada do dia** (entrada
  registrada; uma por pessoa e dia). Um checklist por jornada, garantido
  pelo banco. O guarda-vidas o inicia na tela de checklist; jornada sem
  checklist aparece como **pendente**. Item com problema **não tem efeito
  automático**: aparece em "Problemas de materiais" para a coordenação.
- Pendente: troca de posto no mesmo dia é nova assunção? Item com problema
  deve gerar alerta ou pendência (OD-12, OD-14)?

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

### OD-28 — Registro online precisa de validação?

- Requisito aprovado: a entrada **sem internet** exige validação do
  coordenador. Nada foi dito sobre a online.
- **Provisória (implementada):** registro online **sem divergência** é
  aceito como **validado** na hora (decisão registrada como "Sistema"),
  porque vale a hora do servidor. Com qualquer divergência, vai para
  análise. O coordenador pode rever qualquer registro, com justificativa.
- Alternativa: tudo passa pela fila do coordenador (mais trabalho diário).

### OD-29 — Proximidade do posto

- O pedido fala em "limite configurado e aprovado". **Nenhum limite foi
  aprovado** e os postos não tinham coordenadas.
- **Implementado:** o administrador pode informar latitude, longitude e um
  raio (10 a 5000 m) por posto. **Sem esses dados, a proximidade não é
  avaliada.** Fora do raio (considerando a precisão do GPS) o registro vai
  para análise; nunca é recusado. Precisão pior que o raio vira observação
  ("inconclusivo").
- Pendente: o valor do raio de cada posto (ou um padrão).

### OD-30 — Divergências e tolerâncias

- **Provisório (implementado em `src/features/attendance/rules.ts`):**
  - vão para análise: sem escala confirmada no dia; fora da equipe do posto;
    posto fora de operação; fora do raio; hora do aparelho no futuro;
    relógio do aparelho diferente do servidor em mais de **5 minutos**
    (registros offline); entrada repetida; saída de entrada rejeitada; saída
    antes da entrada;
  - só observação: sem localização; localização imprecisa; posto sem raio;
    relógio diferente em registro online (vale a hora do servidor); relógio
    nunca conferido; sincronização mais de **12 horas** depois; posto
    escolhido diferente da escala (vale a escala).

### OD-31 — Entradas repetidas no mesmo dia

- **Provisório (implementado):** uma jornada por pessoa e dia (garantido
  pelo banco). Segunda entrada **online** é recusada na hora, com a hora da
  primeira. Segunda entrada vinda **sem internet** é guardada como
  "repetida", em análise, e não conta na jornada: nada é descartado.

### OD-32 — Opções de estado dos itens do checklist

- O pedido diz "conforme as opções definidas nos requisitos", mas os
  requisitos não definem opções.
- **Provisória (implementada):** **Em condições**, **Ausente**,
  **Danificado**, **Inadequado** (os três últimos vêm do texto do Prompt 5
  e contam como problema). Observação por item e observações gerais,
  opcionais.
- Pendente: "não se aplica"; observação obrigatória para problemas.

### OD-33 — Quem define a lista de itens

- **Provisória (implementada):** uma lista **por posto**, editada pelo
  **coordenador do posto**. Cada alteração (nome, orientação, ordem,
  desativação) cria uma **nova versão**; checklists já iniciados guardam a
  cópia da época. Itens desativados não entram em checklists novos.
- Pendente: lista padrão comum a todos os postos; copiar lista entre
  postos; itens obrigatórios ou por temporada.

### OD-34 — Correções do checklist

- **Provisória (implementada):** só **o próprio guarda-vidas** corrige um
  checklist enviado, a qualquer momento, com **motivo obrigatório**. A
  correção é uma nova versão completa; as anteriores continuam no
  histórico. A coordenação consulta, não altera respostas.
- Pendente: prazo para correções; correção pela coordenação; registrar que
  um material foi reposto ou consertado (hoje só um novo checklist mostra
  isso).

### OD-35 — Checklist sem internet

- O Prompt 5 manda implementar armazenamento local "se o checklist offline
  estiver aprovado". **Não está** (OD-18).
- **Implementado só online.** Se a conexão cair ao salvar, **nada fica
  guardado no aparelho**; as respostas continuam na tela e a tela diz
  claramente que nada foi salvo. Ao tentar de novo, o mesmo identificador
  de envio é reutilizado, então o servidor nunca grava em dobro. Uma edição
  depois de uma tentativa sem resposta gera um identificador novo (a edição
  nunca é descartada em silêncio).
- Pendente: aprovar ou não o checklist offline. Se aprovado, o desenho da
  presença (fila no IndexedDB + envio idempotente) pode ser reaproveitado.

### OD-36 — Quem envia alerta de reforço

- O pedido diz "o capitão do posto, ou usuário autorizado".
- **Provisória (implementada):** só o **capitão do posto**. "Usuário
  autorizado" não foi definido. Coordenadores não enviam (eles recebem).
- Pendente: substituto quando o capitão não está de serviço; qualquer
  guarda-vidas escalado no dia poder enviar.

### OD-37 — Alertas duplicados

- **Provisória (implementada):** reenviar o mesmo alerta (resposta perdida,
  toque duplo) nunca grava em dobro. Com um alerta ativo no posto, um novo
  só é enviado se o capitão confirmar que é **outra necessidade** (fica
  anotado no histórico). Dois alertas diferentes enviados no mesmo instante
  são ambos guardados.

### OD-38 — Ações sobre o alerta

- **Provisória (implementada):** só os **coordenadores do posto**
  reconhecem, colocam em atendimento e encerram. Cancelar: o autor ou o
  coordenador. Encerrar exige o resultado; cancelar exige o motivo. Toda
  ação exige marcar uma caixa de confirmação e é recusada se o alerta mudou
  desde que a tela foi aberta (evita reconhecimento acidental ou em dobro).
  Autoridade e administradores consultam sem agir.

### OD-39 — Registros operacionais (ocorrências)

- **Provisória (implementada):**
  - registram: guarda-vidas **da equipe do posto** (online);
  - consultam: a equipe do posto (é o livro do posto, não registro
    pessoal), coordenadores da área, autoridade e administradores;
  - categorias e campos: **administradores**, com versões; registros
    antigos mantêm os campos da época;
  - não há edição: registro errado é **anulado** (autor ou coordenador, com
    motivo) e continua visível; um novo registro corrige.
- Pendente: categorias oficiais; edição em vez de anulação; prazo.

### OD-40 — Ocorrências e alertas sem internet

- Não aprovado (OD-18). **Ocorrências: só online**; sem conexão nada é
  gravado e os dados ficam na tela. **Alertas: não são enviados sem
  internet** (nem guardados para depois, para ninguém achar que foram); a
  página de envio abre offline só para orientar o canal oficial.

### OD-41 — Lacunas de pessoal e indicadores

- O pedido fala em "lacunas de pessoal" sem definir efetivo mínimo (OD-26).
- **Provisória (implementada):** lacuna = posto **em operação sem escala
  confirmada** no dia, ou **escalado sem entrada** registrada. Também são
  mostrados: entrada de quem não estava escalado e entrada sem saída.
- As regras de todos os indicadores estão em `docs/ARCHITECTURE.md` ›
  Indicadores e são calculadas em um único lugar
  (`src/features/reports/summary.ts`).
- Pendente: efetivo mínimo por posto e dia (permitiria "faltam N").

### OD-09 — Entrada offline: evidências

- Hora do aparelho basta? Exigir foto/localização? (afeta LGPD).
- **Definido no Prompt 4:** registrar data/hora do aparelho e, **quando
  disponíveis**, localização e precisão do GPS, sem tratá-los como prova.
- **Implementado:** a localização é pedida a cada registro (até 10 s) e
  nunca é obrigatória: negada ou indisponível vira observação. Foto: não.
- Ver OD-19 sobre dados pessoais.

### OD-10 — Entrada offline: validação

- Prazo para sincronizar e validar; efeito de rejeição; chegada depois do
  fechamento do dia; saída também offline?
- **Saída sem internet: NÃO implementada**, por não haver regra aprovada
  (o Prompt 4 pede para implementar só regra aprovada). A saída exige
  internet; sem ela, a tela avisa que a saída não foi registrada. Opções
  para decidir: (a) manter só online; (b) aceitar offline como provisória,
  igual à entrada; (c) registrar offline só a intenção, confirmada depois.
- **Implementado:** sem prazo para sincronizar (atraso maior que 12 h vira
  observação); rejeição **não apaga nem tem efeito automático**: o registro
  fica rejeitado, com justificativa, e pode ser revisto com nova
  justificativa. Chegada depois do fechamento: não há fechamento ainda
  (OD-15).
- Pendente: prazo para o coordenador validar; o que acontece com a jornada
  de uma entrada rejeitada; quem corrige registros errados.

### OD-11 — Materiais, ocorrências e registros do posto

- Tipos e campos de cada um; inventário ou consumo; dados de vítimas.
- **Implementado (Prompt 6, provisório — OD-39):** registros operacionais
  em **categorias configuráveis** (ex.: ocorrência, ação preventiva,
  águas-vivas), cada uma com até 8 campos simples (texto curto, número,
  lista de opções, sim/não) + data/hora + descrição. Nenhuma categoria vem
  pronta: o administrador cria as que forem aprovadas.
- Pendente: as categorias e os campos oficiais; dados de vítimas (OD-19).

### OD-12 — Alertas internos

- Tipos, destinatários, quem reconhece e encerra, notificação fora do app
  (push).
- **Implementado só o alerta de reforço** (Prompt 6). Aviso interno:
  contador de alertas sem reconhecimento no menu do coordenador e listas
  que se atualizam a cada **30 segundos** enquanto abertas (consulta
  periódica). Sem push, e-mail, SMS ou WhatsApp. O aviso é só lembrete: o
  alerta vale pelo registro no servidor.

### OD-13 — Alerta de reforço

- Destinatários; fluxo; procedimento quando o capitão está sem internet.
- **Definido no Prompt 6 e implementado:** o capitão cria; o servidor grava
  antes de confirmar; os coordenadores do posto veem, **reconhecem**,
  colocam **em atendimento** e **encerram**; cancelamento e encerramento
  mantêm o histórico; quem fez cada ação fica registrado.
- Estados: Aguardando reconhecimento → Reconhecido → Em atendimento →
  Encerrado; Cancelado a partir de qualquer estado ativo. Encerrado e
  cancelado são finais (sem reabertura: envia-se um novo alerta).
- Sem internet: a tela diz que **o alerta não foi enviado** e manda usar o
  canal oficial de emergência. **Pendente: qual é o canal oficial**
  (frequência de rádio, telefone) para aparecer na mensagem; hoje o texto é
  genérico (`NOT_SENT_GUIDANCE` em `src/features/alerts/rules.ts`).

### OD-14 — Pendências

- O que gera uma pendência; quem resolve.
- **Provisória (implementada, Prompt 7):** pendência do dia de um posto =
  registro de presença aguardando decisão (entrada, saída ou repetido),
  checklist não enviado (incompleto ou não iniciado) ou alerta ativo
  criado no dia. Quem resolve: a coordenação, nos próprios módulos
  (validação, cobrança do checklist, encerramento do alerta). Não há tela
  de "pendências" separada: elas são calculadas a partir dos registros.

### OD-15 — Fechamento diário

- Por posto ou geral; pendências bloqueiam; o que fica travado; reabertura.
- **Provisória (implementada, Prompt 7):**
  - fechamento **por posto e dia**, feito pelo **coordenador do posto**;
  - estados: **rascunho** (observações, nada congelado) → **enviado**
    (congela um resumo; pode ter pendências, que ficam identificadas) →
    **consolidado** (só sem pendências) → **corrigido** (nova versão com
    motivo, a qualquer momento depois do envio; pode ser consolidado de
    novo). Cada envio, consolidação ou correção é uma **versão imutável**;
  - pendências **bloqueiam só a consolidação**, não o envio;
  - o fechamento **não trava nada**: registros que chegam depois continuam
    sendo aceitos e a tela do fechamento avisa que os dados mudaram desde a
    última versão; a correção registra isso;
  - não há "reabertura": a correção cumpre esse papel sem apagar versões;
  - dia futuro não pode ser fechado.
- Pendente: fechamento geral (todos os postos); travar edições após
  consolidar; prazo para fechar; quem pode corrigir depois de consolidado.

### OD-16 — Histórico de alterações

- Implementado para contas, postos e vínculos (antes/depois, autor, data,
  posto; banco impede alteração). Pendente: retenção e quem consulta o
  histórico operacional.

### OD-17 — Relatórios diários

- Conteúdo, formato (tela, PDF, planilha), destinatários.
- **Provisória (implementada, Prompt 7):** o relatório diário é a **versão
  do fechamento** do posto, vista na tela (imprimível pelo navegador):
  escala, presença validada × provisória, faltas, saídas não registradas,
  checklists, materiais com problema, registros por categoria (inclui
  ações preventivas e águas-vivas quando essas categorias existem),
  alertas e alterações do dia. Destinatários: coordenação, autoridade e
  administradores, pela tela. "Pendente de envio" = dia sem fechamento ou
  em rascunho; "pendente de consolidação" = enviado ou corrigido.
- Pendente: PDF/planilha; envio por e-mail; relatório consolidado de
  vários postos assinado por alguém.

### OD-18 — Matriz offline por funcionalidade

- Proposta em `OFFLINE-STRATEGY.md`. Só a entrada de presença está
  implementada offline.

### OD-19 — Dados pessoais (LGPD)

- Quais dados de vítimas são coletados; retenção; base legal; quem acessa.
- **Ocorrências (Prompt 6):** nenhum campo coleta dados de vítimas e a tela
  avisa para não registrá-los. A descrição é texto livre, então o aviso
  não impede tudo: definir a regra antes de uso real.
- **Localização dos guarda-vidas (Prompt 4):** é dado pessoal. Hoje fica só
  no registro de presença (não vai para logs nem para o histórico), é
  visível ao próprio guarda-vidas, ao coordenador do posto, à autoridade e a
  administradores. No aparelho, registros confirmados são apagados após
  dois dias. Pendente: retenção no servidor, base legal e aviso ao usuário.

### OD-20 — Volume e aparelhos

- Número de postos, usuários e aparelhos; aparelhos pessoais ou do posto
  (compartilhados); Android/iOS.
