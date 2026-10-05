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
