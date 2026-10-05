# MarioFin

Sistema de gestão financeira pessoal (conta única).

## Estrutura

- `frontend/` — Next.js + React + TypeScript (painel em azul, azul-escuro/preto e branco)
- `backend/` — API (Next.js route handlers) + Prisma + PostgreSQL

## Funcionalidades do painel

- Visão geral por mês (navegação entre meses): saldo previsto, entradas, despesas, parcelas, pago, pendente e atrasado
- Gráficos de entradas × saídas e de despesas por categoria
- Calendário financeiro mensal, com pagamento direto pelos eventos
- Rendas, entradas extras, despesas e dívidas com criação, edição e exclusão
- Registro de pagamento de despesas e parcelas (forma de pagamento e data)
- Parcelas de cada dívida com barra de progresso
- Busca, filtro por status e exportação CSV nas listas
- Categorias, histórico de pagamentos e atividades recentes

## Como executar

Veja `backend/README.md` (variáveis, banco e comandos) e `DEPLOY-FIX.md` (deploy: Railway + Vercel).
