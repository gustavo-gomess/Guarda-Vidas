# Backup e restauração

> **Status: não implementado.** O PostgreSQL está configurado (local, via
> Docker), mas ainda não há modelos nem dados reais, e nenhum ambiente de
> produção. O procedimento abaixo **precisa estar pronto e testado antes do
> primeiro dado real**. O banco local de desenvolvimento não tem backup e
> pode ser recriado (`docker compose down -v`).

## Código

- Fonte da verdade: repositório `github.com/gustavo-gomess/Guarda-Vidas`.
  O remoto ainda não recebeu nenhum push; até lá, o histórico existe só
  nesta máquina.
- Segredos **não** ficam no Git. Quando existirem, precisam de um local de
  guarda próprio (gerenciador de senhas ou painel da hospedagem) e de uma
  pessoa responsável.

## Banco de dados (quando adotado)

A definir junto com a hospedagem. O procedimento deverá responder:

- [ ] Frequência do backup e retenção (ex.: diário, 30 dias).
- [ ] Onde ficam as cópias (fora do provedor principal?).
- [ ] Criptografia das cópias (dados pessoais / LGPD).
- [ ] Ferramenta: backup automático do provedor e/ou `pg_dump` agendado.
- [ ] Passo a passo de restauração, **testado** em um banco descartável.
- [ ] RPO/RTO aceitáveis (quanto dado se pode perder e em quanto tempo
      restaurar).

Regras que já valem (de `CLAUDE.md`): nunca resetar, truncar ou apagar dados
de produção e nunca rodar migrações destrutivas sem aprovação explícita.

## Arquivos enviados por usuários (se houver)

A definir: local de armazenamento, backup e política de retenção.
