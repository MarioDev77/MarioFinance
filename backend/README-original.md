# MARIOFIN — Backend de Gestao Financeira Pessoal

Backend completo e pronto para producao de um sistema financeiro pessoal
(renda, receitas, despesas, dividas/parcelamentos, pagamentos, calendario,
dashboard e auditoria), construido com seguranca como requisito central.

## Decisoes de arquitetura (importantes)

1. **Monolito Next.js (App Router) + Route Handlers.** Toda a logica fica
   server-side; o frontend nunca armazena dados financeiros. O PostgreSQL e
   a unica fonte da verdade.
2. **Uma unica conta, sem rota publica de cadastro.** O usuario e criado
   exclusivamente pelo `prisma/seed.ts`, com credenciais vindas de variaveis
   de ambiente (`ADMIN_EMAIL`/`ADMIN_PASSWORD`). A senha e hasheada com
   bcrypt (custo 12) e **nunca** fica hardcoded.
3. **Sessao server-side em tabela `sessions`.** O cookie contem apenas
   `token.assinaturaHMAC` (HTTPOnly, SameSite=Lax, Secure em producao, Path=/,
   7 dias). O token em si e armazenado como SHA-256 (`tokenHash`) — nem
   roubo do banco expoe sessoes. O login revoga a sessao anterior
   (rotacao de sessao) e existe `logout` com revogacao real.
4. **CSRF em duas camadas:** cookie SameSite=Lax + validacao de `Origin/Referer`
   no middleware + exigencia do header `x-csrf-token` (token gerado na criacao
   da sessao) em **toda** operacao mutavel (POST/PATCH/DELETE).
5. **IDOR tratado como regra, nao excecao.** Toda rota com `[id]` executa
   `assertOwnership()`: o registro e buscado pelo banco e conferido contra
   `userId` da sessao. Registro alheio retorna **404** (nao revela
   existencia). A arquitetura ja esta pronta para multi-usuario no futuro.
6. **Dinheiro nunca em float.** Todos os valores sao `Decimal @db.Decimal(14,2)`
   no PostgreSQL e `decimal.js` no servidor (aritmetica exata). O backend
   recalcula totais/parcelas e **desconfia de qualquer valor enviado pelo
   frontend** (Zod + recalculo server-side).
7. **Plano de parcelas gerado no servidor:** valor base = total/count
   arredondado (meio para cima); a ultima parcela absorve os centavos,
   garantindo soma exata. Pagamento de parcela recalcula `paidAmount`
   direto de um `aggregate` do banco (nunca incremento cego) e atualiza o
   status da divida (PAID quando nao ha pendentes e total quitado) — tudo
   em transacao.
8. **Soft delete + auditoria imutavel.** Entidades financeiras usam
   `deletedAt/deletedBy` com `restore`. A tabela `audit_logs` registra
   quem, o que, quando, registro afetado e old/new data (com IP) para
   CREATE/UPDATE/DELETE/RESTORE/LOGIN/LOGOUT/PAYMENT. **Nao existe
   endpoint para apagar logs.**
9. **Validacao Zod em 100% dos inputs**, incluindo enums de status/metodos,
   IDs UUID, limites de valores, quantidade de parcelas (1..480) e formatos
   de data. SQL injection e neutralizado pelo Prisma ORM (sem concatenacao).
10. **Rate limiting** no login (10 req/min/IP) + **lockout** de 15 min apos
    5 falhas, com resposta generica (anti user enumeration) e custo bcrypt
    mesmo para email inexistente (anti timing attack).

## Stack

- Next.js 15 (App Router, route handlers `runtime = 'nodejs'`)
- TypeScript (strict)
- PostgreSQL 14+
- Prisma ORM + migrations
- Zod (validacao)
- bcryptjs (senha)
- decimal.js (dinheiro)
- Vitest (testes)

## Estrutura de pastas

```
mariofin/
├── prisma/
│   ├── schema.prisma          # modelos, enums, indices, constraints
│   └── seed.ts                # cria a UNICA conta (env-only, seguro)
├── src/
│   ├── middleware.ts          # security headers + checagem de origem (CSRF)
│   ├── lib/
│   │   ├── prisma.ts          # singleton do client
│   │   ├── http.ts            # respostas padronizadas, tratamento de erro
│   │   ├── schemas.ts         # validacoes Zod
│   │   ├── finance.ts         # matematica financeira (pure, testavel)
│   │   ├── session.ts         # sessao, cookie, IDOR, CSRF
│   │   ├── crypto.ts          # HMAC do cookie, hash de token
│   │   ├── password.ts        # bcrypt + schema de senha
│   │   ├── rate-limit.ts      # rate limit + lockout de login
│   │   ├── audit.ts           # escrita imutavel de auditoria
│   │   └── overdue.ts         # atualizacao lazy de vencidos
│   └── app/api/
│       ├── health/            # GET  /api/health
│       ├── auth/              # POST /api/auth/login | logout
│       │   └── me/            # GET  /api/auth/me
│       ├── income/            # GET, POST /api/income | [id] GET/PATCH/DELETE | [id]/restore
│       ├── receipts/          # idem + filtros from/to
│       ├── expenses/          # idem + [id]/pay
│       ├── debts/             # GET, POST (gera parcelas) | [id] | [id]/restore
│       ├── installments/      # GET, [id] GET | [id]/pay (transacional)
│       ├── payments/          # GET (filtros), POST, [id] GET/PATCH/DELETE
│       ├── calendar/          # GET ?year&month
│       ├── categories/        # GET, POST | [id] GET/PATCH/DELETE
│       ├── dashboard/         # GET ?month&year | ?from&to
│       └── audit/             # GET (somente leitura, paginado)
└── tests/                     # vitest (validacao, financeiro, seguranca)
```

## Instalacao

```bash
# 1. requisitos: Node 20+, PostgreSQL 14+
npm install

# 2. configure o ambiente
cp .env.example .env
# edite .env: DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD

# 3. banco + migrations + seed (cria a unica conta e categorias padrao)
npm run db:migrate
npm run db:seed

# 4. rode
npm run dev        # http://localhost:3000
```

## Variaveis de ambiente

| Variavel         | Obrigatoria | Descricao                                        |
|------------------|-------------|--------------------------------------------------|
| `DATABASE_URL`   | sim         | conexao PostgreSQL (server-side apenas)           |
| `SESSION_SECRET` | sim         | segredo HMAC do cookie (min. 16 chars)            |
| `ADMIN_EMAIL`    | sim (seed)  | email da unica conta                              |
| `ADMIN_PASSWORD` | sim (seed)  | senha inicial (min. 8 chars, com letras e numeros)|
| `ALLOWED_ORIGINS`| nao         | origens extras permitidas (CSRF/CORS), separadas por virgula |

**Nenhum secret vai para o frontend.** Tudo e lido apenas no servidor.

## Fluxo de autenticacao

1. `POST /api/auth/login` `{ email, password }`
   -> valida (bcrypt), revoga sessao anterior, cria sessao no banco,
      seta cookie HTTPOnly, retorna `{ user, csrfToken }`.
2. Requisicoes mutaveis devem enviar o header `x-csrf-token: <csrfToken>`.
3. `GET /api/auth/me` retorna o usuario e o `csrfToken` da sessao ativa.
4. `POST /api/auth/logout` revoga a sessao e limpa o cookie.

Todas as demais rotas exigem sessao valida; caso contrario:
`401 { success:false, error:{ code:"UNAUTHORIZED", ... } }`.

## Dinheiro e calculos

- Tipos: `NUMERIC(14,2)` no banco; `decimal.js` no servidor; respostas em
  string com 2 casas (`"300.00"`).
- `POST /api/debts` recebe apenas `originalAmount`, `interestAmount`,
  `installmentCount`, `firstDueDate` — o servidor calcula `totalAmount`,
  `installmentAmount` e gera todas as parcelas em transacao.
- `POST /api/installments/[id]/pay` registra `paidAt`, cria o `Payment`,
  recalcula `paidAmount` do banco e promove a divida a `PAID` quando
  quitada. O mesmo vale para `POST /api/expenses/[id]/pay`.
- Dashboard: saldo previsto = entradas previstas - saidas previstas;
  restante de divida = total - pago; percentual comprometido =
  obrigacoes pendentes / renda prevista (0% se renda = 0).

## Respostas padronizadas

Sucesso: `{ "success": true, "data": ... }`
Erro: `{ "success": false, "error": { "code": "...", "message": "..." } }`

Nunca sao expostos: stack trace, senha, token, DATABASE_URL, detalhes
internos de banco.

## Seguranca (checklist implementado)

| Ameaça        | Mitigacao                                                        |
|---------------|------------------------------------------------------------------|
| IDOR          | `assertOwnership` em toda rota com `[id]`, 404 generico          |
| SQL Injection | Prisma ORM, zero SQL concatenado                                 |
| XSS           | CSP estrita + escaping no frontend (React) + validacao Zod       |
| CSRF          | SameSite=Lax + Origin check + `x-csrf-token` nas rotas           |
| Brute force   | rate limit no login + lockout 15 min apos 5 falhas               |
| Enumeration   | mensagem generica + bcrypt dummy em usuario inexistente          |
| Segredos      | 100% server-side via `.env`; cookie assinado HMAC                |
| Sessao fixa   | rotacao de sessao no login; revogacao no logout                  |
| Exposicao DB  | token de sessao armazenado como SHA-256                         |
| Headers       | CSP, nosniff, DENY frame, Referrer-Policy, Permissions-Policy, HSTS (prod) |
| Auditoria     | logs imutaveis com old/new data + IP; sem endpoint de exclusao   |
| Soft delete   | `deletedAt/deletedBy` + restore em todas as entidades financeiras|

## Testes

```bash
npm test
```

Cobrem: valores negativos/zero, parcelas invalidas, status/metodos
inventados, datas invalidas, formatacao monetaria, distribuicao exata de
parcelas (resto na ultima), clamp de datas, recorrencia de renda,
rate limiting, lockout de login, HMAC e hash de tokens.

Recomendacao para testes de integracao direta na API (IDOR, CSRF, brute
force) com banco de teste:

```bash
DATABASE_URL=postgresql://.../mariofin_test npx prisma migrate deploy
# depois, com a app em `npm run dev`, exercite:
curl -i http://localhost:3000/api/debts/algum-id-sem-sessao   # -> 401
```

## Producao

1. `npm run build` (roda `prisma generate` + `next build`)
2. `npm run db:deploy` (migrations)
3. `npm run db:seed` (apenas no primeiro deploy)
4. `npm run start` atras de HTTPS (o cookie vira `Secure` e o HSTS entra
   em vigor automaticamente com `NODE_ENV=production`)
5. Coloque um proxy (Nginx/Cloudflare) limitando tambem por IP.
6. Backups do PostgreSQL + retencao de `audit_logs`.

## Migracao e banco

- Toda mudanca estrutural: `npx prisma migrate dev --name descricao`
- Constraints presentes: PKs, FKs com `onDelete` explicito, `NOT NULL`,
  `UNIQUE` (email, categoria por usuario/tipo, numero da parcela por divida),
  enums nativos do PostgreSQL e indices apenas onde ha consulta real
  (`userId+status+dueDate`, `dueDate+status`, `userId+deletedAt`, etc.).
