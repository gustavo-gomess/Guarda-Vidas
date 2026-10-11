# Estratégia offline

O requisito RF-13 diz que o funcionamento offline é **avaliado por
funcionalidade**. Este documento propõe a matriz (OD-18) e descreve o único
fluxo offline implementado: a **entrada de presença**.

## Matriz por funcionalidade (proposta, pendente de aprovação — OD-18)

| Funcionalidade                     | Sem internet                                       | Situação                           |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------- |
| Login                              | Não (exige servidor)                               | Definido (segurança)               |
| **Entrada de presença**            | **Sim: provisória, guardada no aparelho**          | **Aprovado (RF-03), implementado** |
| Saída de presença                  | **Não**: exige internet                            | **Pendente (OD-10)**               |
| Consultar a própria escala         | Só a última versão aberta online (página em cache) | Implementado como efeito do cache  |
| Disponibilidade, escala, validação | Não                                                | Proposta: online apenas            |
| Checklist e materiais              | **Não**: online, com reenvio seguro (sem duplicar) | **Pendente (OD-35)**               |
| Ocorrências e registros do posto   | A decidir por funcionalidade                       | Pendente                           |
| Alerta de reforço                  | Não chega a ninguém sem internet                   | Pendente (OD-13)                   |

## Entrada de presença sem internet

### Garantias

- Uma entrada feita sem internet **nunca** vira presença oficial sozinha:
  ela é registrada no aparelho, enviada quando a conexão volta e fica
  **aguardando validação do coordenador**.
- A tela só diz "recebido pelo servidor" depois de uma resposta real do
  servidor com o registro. Falta de resposta, erro de rede, portal de Wi-Fi
  ou erro do servidor contam como **não enviado**.
- O registro nunca é apagado do aparelho por falha de rede, sessão expirada
  ou outra conta conectada. Só sai depois de confirmado (e, por economia de
  dados pessoais, dois dias após a confirmação).
- Reenviar é seguro: o servidor é **idempotente** pelo identificador gerado
  no aparelho. O mesmo registro enviado várias vezes (inclusive ao mesmo
  tempo) é gravado uma vez. O mesmo identificador com dados diferentes é
  recusado e o original é mantido.

### Estados

| Estado                    | Onde fica | Significado                                                 |
| ------------------------- | --------- | ----------------------------------------------------------- |
| Registrado neste aparelho | aparelho  | Gravado no IndexedDB, nunca enviado                         |
| Sincronização pendente    | aparelho  | Tentativa sem confirmação; será reenviado                   |
| Aguardando validação      | servidor  | Recebido; entrada sem internet aguarda o coordenador        |
| Validado                  | servidor  | Presença oficial                                            |
| Rejeitado                 | servidor  | Recusado pelo coordenador, com justificativa (mantido)      |
| Divergência em análise    | servidor  | Algo não confere (escala, relógio, distância, repetição...) |

### Como funciona

1. **Abrir sem internet:** um service worker próprio (`public/sw.js`, sem
   biblioteca) guarda a página `/presenca` (rede primeiro, cache se
   offline) e os arquivos estáticos do build. Nenhuma chamada de API é
   respondida pelo cache. A página precisa ter sido aberta **com internet**
   ao menos uma vez no aparelho, com login feito.
2. **Registrar:** ao tocar em "Registrar entrada", o aparelho anota a hora,
   tenta a localização (até 10 s; pode ser negada) e grava o registro no
   IndexedDB **antes** de enviar.
3. **Enviar:** com internet, envia na hora (`mode: online`; vale a hora do
   servidor). Sem resposta, o registro fica pendente e é reenviado como
   `offline` quando o navegador volta a ficar online, ao abrir a página ou
   pelo botão "Enviar agora".
4. **Relógio:** sempre que há internet, o aparelho mede a diferença do seu
   relógio para o do servidor (`/api/presenca/hora`). A última medida vai
   junto com registros offline; o coordenador vê a hora declarada e a hora
   estimada corrigida. Nenhuma das duas é prova.
5. **Servidor:** classifica o registro, procura a escala do dia, avalia a
   proximidade (se configurada) e grava o registro original sem alteração
   possível (trigger), com a primeira decisão ("recebido") e o histórico.

### Limitações conhecidas

- **Navegador anônimo ou armazenamento bloqueado:** sem IndexedDB nada pode
  ser guardado offline; a tela avisa.
- **iOS/Safari** pode apagar dados de sites pouco usados. O app pede
  armazenamento persistente (`navigator.storage.persist`), mas o navegador
  pode negar. Instalar o app na tela inicial reduz o risco. Precisa de
  teste em aparelhos reais.
- **Sessão expirada offline:** os registros ficam guardados e são enviados
  depois de um novo login. O login exige internet.
- **Aparelho compartilhado:** registros de outra conta ficam no aparelho até
  essa pessoa entrar. A página em cache é apagada ao abrir a tela de login.
- **Nada disso foi testado em navegador real nesta etapa.** A lógica da fila
  e do servidor tem testes automatizados; o service worker, o IndexedDB e a
  geolocalização precisam de teste com Playwright e em campo.
