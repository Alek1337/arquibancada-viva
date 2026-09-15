# Fundação de autenticação

O projeto usa Better Auth 1.7.4 pelo handler Fetch API e pelo adaptador Drizzle oficiais. A integração comunitária de NestJS não é dependência do projeto. O spike da TFT-007 comprovou a compatibilidade e a TFT-008 promoveu o resultado para `packages/auth`.

## Limite de integração

- `packages/auth` cria o runtime, oculta os tipos do Better Auth e expõe apenas handler, resolução de identidade e adaptador Fetch.
- O catch-all `/v1/auth/*` vive no mesmo Fastify usado pelo NestJS.
- O adaptador compartilhado converte headers com `fromNodeHeaders`, reserializa corpos JSON já analisados pelo Fastify uma única vez e preserva `string` ou bytes crus sem conversão.
- Headers da resposta, inclusive múltiplos `Set-Cookie`, são encaminhados ao Fastify.
- `trustedOrigins` do Better Auth faz a proteção de origem/CSRF aplicável às mutações; `@fastify/cors` limita a origem do navegador e um hook Fastify rejeita explicitamente qualquer `Origin` diferente da allowlist antes do handler.
- Cookies usam prefixo próprio e, em produção, são `HttpOnly`, `Secure` e `SameSite=Lax`.
- O logger Fastify possui redaction estrutural para cookies, autorização, tokens, senhas e segredos. Eventos próprios de autenticação nunca registram corpo ou headers e descartam mensagens de erro.

## Sessão comum

`AuthRuntime.resolveIdentity` é a única operação pública de leitura de sessão. A rota REST `/v1/me/session` e o middleware do namespace Socket.IO `/auth` chamam essa mesma operação e recebem somente `userId` e `sessionId`. Contas, tokens e identificadores de Google, Facebook ou Instagram não atravessam esse limite. A topologia definitiva de salas será tratada na TFT-011.

## Schema e migrations

O schema Drizzle em `packages/database/src/schema/auth/better-auth.ts` é gerado pela CLI oficial com:

```text
pnpm auth:schema
pnpm db:generate
pnpm db:check
```

A CLI gera `user`, `session`, `account` e `verification` dentro do schema PostgreSQL `auth`. A aplicação da migration continua fora do boot da API.

## Limites funcionais

O caminho oficial é compatível com ESM, Fastify 5, Drizzle 0.45 e Socket.IO 4 neste repositório. Não foi necessário adaptador comunitário, patch em dependência ou acesso a API interna do Better Auth.

O handler oficial exige uma ponte explícita entre Fastify e `Request`/`Response`, conforme a própria documentação. Essa ponte ficou isolada e coberta por testes. Cadastro definitivo, confirmação de e-mail, provedores sociais e política de idade permanecem fora desta fundação.
