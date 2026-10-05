# MarioFin

Sistema de gestão financeira pessoal com **uma única conta**, frontend separado do backend, PostgreSQL + Prisma e autenticação por sessão HTTP-only.

## O que foi integrado

### Backend
- API real em `backend/src/app/api/[[...path]]/route.ts`.
- Login, logout e sessão persistente.
- Cookie de sessão `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- Token CSRF para operações mutáveis.
- CORS configurável por `ALLOWED_ORIGINS`.
- Rate limit básico para login.
- Validação server-side.
- Proteção de propriedade/IDOR.
- Headers de segurança.
- Auditoria de operações.
- PostgreSQL + Prisma.
- Rendas mensais e recorrentes.
- Entradas extras.
- Despesas.
- Dívidas com valor bruto, juros, quantidade de parcelas e vencimentos.
- Cálculo das parcelas no backend, com correção de centavos na última parcela.
- Registro de pagamentos.
- Calendário financeiro.
- Dashboard com entradas, saídas e saldo previsto.
- Marcação de despesas/parcelas como pagas.
- Exclusão lógica dos registros principais.

### Frontend
- Login real conectado à API.
- Dashboard conectado ao banco.
- Cadastro de rendas, entradas extras, despesas e dívidas.
- Listagem, edição e exclusão dos registros.
- Calendário, categorias, histórico de pagamentos e atividades.
- Pagamento de despesas e parcelas direto pelo painel.
- Busca, filtros por status e exportação CSV.
- Visualização das próximas parcelas e despesas.
- Cliente HTTP centralizado em `frontend/lib/api.ts`.
- Interface responsiva em azul, azul-escuro/preto e branco.

## Estrutura

```text
MarioFin/
├── frontend/
│   ├── app/
│   ├── lib/api.ts
│   └── public/
└── backend/
    ├── prisma/
    │   ├── schema.prisma
    │   └── seed.ts
    └── src/
        ├── app/api/[[...path]]/route.ts
        ├── lib/
        └── middleware.ts
```

## Como executar

### 1. PostgreSQL
Crie um banco chamado `mariofin`.

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Edite o `.env` e defina:
- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET` (mínimo de 32 caracteres)
- `ALLOWED_ORIGINS=http://localhost:3000`

Depois:

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

O backend ficará em `http://localhost:3001`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

O frontend ficará em `http://localhost:3000`.

`NEXT_PUBLIC_API_URL` deve apontar para `http://localhost:3001`.

## Importante

O ambiente desta preparação não concluiu a instalação das dependências dentro do limite disponível, portanto **não foi declarado um build de produção como aprovado**. Depois de instalar as dependências localmente, rode `pnpm build` em cada pasta para a validação final.

Não existe rota pública de cadastro. A conta inicial é criada pelo seed usando `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
