# MarioFin

Sistema de gestão financeira pessoal.

## Estrutura

- `frontend/` — Next.js + React + TypeScript
- `backend/` — base do backend/API + Prisma + PostgreSQL

## Estado desta organização

Esta versão organiza o material existente no ZIP e remove o material temporário da Granja Oliveira.
Ela **não inventa as APIs ausentes**. O backend enviado ainda precisa da implementação das rotas `/api`, além dos módulos auxiliares importados por `session.ts`.

### Backend ainda necessário para ficar executável

- `src/lib/prisma.ts`
- `src/lib/http.ts`
- `src/lib/crypto.ts`
- `src/lib/password.ts`
- `src/lib/schemas.ts`
- `src/lib/rate-limit.ts`
- `src/lib/audit.ts`
- `src/lib/overdue.ts`
- rotas `/api/auth/*`
- rotas de receitas, despesas, dívidas, parcelas, pagamentos, dashboard e calendário
- `package.json`, `tsconfig.json` e configuração de execução do backend

## Banco

O schema Prisma foi colocado em `backend/prisma/schema.prisma`.

## Próximo passo

Implementar o backend/API e então conectar o frontend por uma camada única de API.
