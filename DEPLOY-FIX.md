# MarioFin — correção do login em produção

## Causa do erro

O endpoint `POST /api/auth/login` cria uma sessão e assina o cookie com `SESSION_SECRET`.
Quando essa variável não existe no backend, o login termina em erro 500.

O `GET /api/auth/me` retornar 401 antes do login é normal: significa que ainda não existe uma sessão autenticada.

## Variáveis do BACKEND

Configure no serviço onde o backend está hospedado:

- `DATABASE_URL` = URL do PostgreSQL de produção
- `ADMIN_EMAIL` = e-mail usado pelo usuário inicial
- `ADMIN_PASSWORD` = senha do usuário inicial (mínimo 8 caracteres)
- `SESSION_SECRET` = segredo aleatório com **pelo menos 32 caracteres**
- `ALLOWED_ORIGINS` = `https://mario-finance-three.vercel.app`
- `NODE_ENV` = `production`

Não coloque `DATABASE_URL` ou `SESSION_SECRET` no frontend.

## Variável do FRONTEND

No serviço do frontend:

- `NEXT_PUBLIC_API_URL` = URL pública do backend, sem `/api` no final.

Exemplo:

```text
NEXT_PUBLIC_API_URL=https://seu-backend.exemplo.com
```

## Depois de salvar as variáveis

1. Faça um novo deploy/redeploy do backend.
2. Faça um novo deploy do frontend.
3. Abra o site em uma janela anônima.
4. Faça login com o `ADMIN_EMAIL` e `ADMIN_PASSWORD` configurados no backend.

## Console do navegador

- `401 /api/auth/me` antes do login: normal.
- `500 /api/auth/login`: indicava configuração do backend; com esta versão, uma `SESSION_SECRET` ausente/inválida aparece como erro de configuração.
- O script antigo do Vercel Analytics foi removido desta versão para evitar o `404` mostrado no console quando o script não está disponível no deploy atual.

## Erro "Rota não encontrada." (404) em Recebimentos do mês

Significa que o backend publicado é mais antigo que o frontend e não tem a rota `incoming`.

1. Abra `https://SEU-BACKEND/api/health`. A versão correta responde `build: "routes-fix-2026-10-05-b"` e uma lista `routes` contendo `incoming`.
2. Se não responder isso, faça redeploy do backend (Railway):
   - o serviço deve apontar para o repositório/branch atual, com **Root Directory = `backend`**;
   - faça o commit e push desta versão e use *Redeploy* sem cache.
3. Confira `NEXT_PUBLIC_API_URL` no frontend (Vercel): URL do backend, sem `/api` no final. Depois de alterar, faça novo deploy do frontend.

## Dívida com mais de uma data por mês (ex.: celular)

Em **Dívidas e parcelas → Nova dívida → "Mais de uma data por mês"**:

- Mês da primeira parcela: `2026-09`
- Plano 1: R$ 100,00 × 12, dia 5
- Plano 2: R$ 50,00 × 12, dia 15
- Meses já pagos: `1` (pagou 05/09 e 15/09; as próximas ficam 05/10 e 15/10)

Total R$ 1.800,00 em 24 parcelas, numeradas por data. Os meses já pagos entram como PAGO e geram o registro em Pagamentos (forma "Outro").

Para trocar a dívida "celular" atual (12x R$ 150): exclua e cadastre de novo com os dados acima. Excluir uma dívida agora também remove os pagamentos ligados a ela. Não precisa de migração de banco (não houve mudança no `schema.prisma`).

Também mudou: parcela que vence **hoje** não é mais marcada como atrasada (só a partir do dia seguinte).

Depois do deploy, `/api/health` deve responder `build: "multi-schedule-2026-10-05"`.

## Minha parte das parcelas (dívida dividida)

- Na dívida, o botão de moedas ("Definir minha parte") aplica a todas as parcelas um **percentual** ou **valor fixo**, em todas ou só nas não pagas. Também remove a divisão.
- Clique em qualquer parcela (ou no lápis) para editar: valor, **minha parte**, situação, data e forma de pagamento, descrição.
- Com a minha parte definida, o painel, o calendário e o botão Pagar usam o **seu** valor. O total da dívida continua o inteiro, e a dívida mostra também "Minha parte: paguei X de Y".
- Aplicar a minha parte em parcelas já pagas também ajusta o valor do pagamento registrado.

### ATENÇÃO: coluna nova no banco
Esta versão adiciona o campo opcional `myAmount` em `DebtInstallment`. O comando `start` do backend agora roda `prisma db push --skip-generate` antes de subir, então o Railway cria a coluna sozinho no próximo deploy. Se o deploy falhar por causa disso, rode `npx prisma db push` apontando para o banco de produção. Sem a coluna, a tela de dívidas dá erro 500.

`/api/health` deve responder `build: "my-share-2026-10-05"`.
