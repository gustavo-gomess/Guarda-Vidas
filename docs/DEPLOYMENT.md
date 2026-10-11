# Deploy

> **Status: não implementado.** Não há hospedagem escolhida, ambiente de
> produção nem pipeline de deploy. Nenhum deploy deve ser feito sem
> aprovação explícita.

## O que já está pronto e verificado localmente

- **Build:** `npm run build` (gera o cliente Prisma e o build do Next.js).
  **Não precisa de `DATABASE_URL` nem de banco.** Precisa de internet
  (`next/font/google` baixa a fonte Geist).
- **Start:** `npm run start` (Node.js 22). Se o ambiente for inválido, o
  processo **encerra com código 1** e mensagem que cita a variável (nunca o
  valor). A plataforma deve tratar isso como falha de deploy.
- **Migrações:** rodar `npm run db:deploy` (`prisma migrate deploy`) antes de
  subir a nova versão. Nunca `migrate dev`, `db push` ou `migrate reset` em
  produção.
- **Health check:** `GET /api/health`: 200 `{"status":"ok","database":"ok"}`
  ou 503 `{"status":"error","database":"unavailable"}` (detalhes só no
  log). Sem cache. Use como verificação de saúde da plataforma.
- **Logs:** em produção, uma linha JSON por evento no stdout/stderr, com
  dados sensíveis do contexto ocultados.
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS (só com `NODE_ENV=production`); sem
  `X-Powered-By`.

### Variáveis de produção

| Variável       | Valor                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL` | URL do PostgreSQL gerenciado, com TLS (`?sslmode=require` ou equivalente do provedor) |
| `LOG_LEVEL`    | `info` (ou `warn`)                                                                    |
| `NODE_ENV`     | `production` (definido pelo `next start`)                                             |

### Autenticação em produção

- **HTTPS obrigatório.** Em produção o cookie de sessão é
  `__Host-gv_session` com `Secure`: navegadores o recusam por HTTP, e o
  login não funciona.
- **Primeiro administrador:** depois do primeiro `npm run db:deploy`, rodar
  `npm run admin -- create --username ... --name "..."` em ambiente
  confiável com a `DATABASE_URL` de produção (veja `DEVELOPMENT.md` ›
  Primeiro administrador). O comando se recusa a rodar quando já existe
  administrador ativo.
- Rate limiting por IP no login não existe na aplicação (só bloqueio por
  conta). Se a hospedagem oferecer (proxy/CDN/WAF), ativar para `/login`.

### Banco em produção

- Usuário da aplicação **sem** privilégios de superusuário; idealmente um
  usuário para migrações e outro, mais restrito, para a aplicação.
- Backups automáticos do provedor ativados antes de qualquer dado real
  (veja `BACKUP-RESTORE.md`).

## Decisão pendente: hospedagem

Critérios definidos: simples e de baixo custo. A escolha depende de:

- Provedor de PostgreSQL gerenciado (o banco é necessário).
- Região dos usuários (latência no Brasil) e requisitos de LGPD.
- Necessidade de tarefas agendadas, filas ou armazenamento de arquivos.

Opções a avaliar quando os requisitos existirem (nenhuma foi testada):

- Vercel (integração nativa com Next.js) + PostgreSQL gerenciado (ex.: Neon).
- Railway ou Render (app Node + PostgreSQL na mesma plataforma).
- VPS com Docker (mais barato, mais manutenção).

## A definir antes do primeiro deploy

- [ ] Hospedagem e ambientes (preview, produção).
- [ ] Gestão de segredos na plataforma.
- [ ] Domínio e HTTPS.
- [x] Headers de segurança básicos no `next.config.ts`.
- [ ] Content-Security-Policy (junto com o service worker do modo offline).
- [ ] Etapa de `npm run db:deploy` no pipeline de deploy.
- [ ] Monitoramento de erros e logs.
- [ ] Procedimento de rollback.
- [ ] Backup do banco (veja `BACKUP-RESTORE.md`).
