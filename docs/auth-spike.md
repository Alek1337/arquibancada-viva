# Spike Better Auth + NestJS/Fastify

O TFT-007 usa Better Auth 1.7.4 pelo handler Fetch API e pelo adaptador Drizzle oficiais. A integração comunitária de NestJS não é dependência do projeto.

## Limite de integração

- O catch-all `/v1/auth/*` vive no mesmo Fastify usado pelo NestJS.
- O adaptador converte headers com `fromNodeHeaders`, reserializa corpos JSON já analisados pelo Fastify uma única vez e preserva `string` ou bytes crus sem conversão.
- Headers da resposta, inclusive múltiplos `Set-Cookie`, são encaminhados ao Fastify.
- `trustedOrigins` do Better Auth faz a proteção de origem/CSRF aplicável às mutações; `@fastify/cors` limita a origem do navegador e um hook Fastify rejeita explicitamente qualquer `Origin` diferente da allowlist antes do handler.
- Cookies usam prefixo próprio e, em produção, são `HttpOnly`, `Secure` e `SameSite=Lax`.

## Sessão comum

`resolveBetterAuthSession` é a única operação de leitura de sessão do spike. A rota REST `/v1/auth-spike/session` e o middleware do namespace Socket.IO `/auth-spike` chamam essa mesma operação. O namespace existe apenas como prova técnica e será substituído pela fundação reutilizável do TFT-008 e pela topologia de salas do TFT-011.

## Schema e migrations

O schema Drizzle em `packages/database/src/schema/auth/better-auth.ts` é gerado pela CLI oficial com:

```text
pnpm --filter @arquibancada-viva/api auth:schema
pnpm db:generate
pnpm db:check
```

A CLI gera `user`, `session`, `account` e `verification` dentro do schema PostgreSQL `auth`. A aplicação da migration continua fora do boot da API.

## Resultado e limitações

O caminho oficial é compatível com ESM, Fastify 5, Drizzle 0.45 e Socket.IO 4 neste repositório. Não foi necessário adaptador comunitário, patch em dependência ou acesso a API interna do Better Auth.

O handler oficial exige uma ponte explícita entre Fastify e `Request`/`Response`, conforme a própria documentação. Essa ponte ficou isolada e coberta por testes. Social login, confirmação de e-mail, política de idade e rotas definitivas permanecem fora do spike.
