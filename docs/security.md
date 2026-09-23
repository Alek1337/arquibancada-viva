# Baseline de segurança

A API aplica uma política única antes das rotas de produto. O objetivo desta etapa é reduzir a superfície pública, manter respostas previsíveis e impedir que credenciais sejam expostas por logs ou erros.

## Fronteira HTTP

- CORS aceita exatamente a origem de `WEB_ORIGIN`; origens diferentes recebem HTTP 403.
- Credenciais são permitidas somente para essa origem. Métodos aceitos: `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH` e `DELETE`.
- Cabeçalhos de entrada permitidos: `Authorization`, `Content-Type`, `Idempotency-Key` e `X-Requested-With`.
- O corpo HTTP tem limite global configurável por `API_BODY_LIMIT_BYTES`, com padrão de 64 KiB e máximo configurável de 1 MiB.
- IDs de requisição fornecidos pelo cliente são ignorados. A API gera UUIDv7 e o devolve em `X-Correlation-Id`.
- `trustProxy` permanece desativado. Uma futura implantação atrás de proxy deve habilitá-lo somente com a topologia e a lista de proxies confiáveis definidas.
- Fastify rejeita chaves `__proto__` e `constructor` em payloads. Helmet envia cabeçalhos defensivos; HSTS é habilitado somente em produção, onde TLS deve terminar no proxy de borda.

Erros públicos usam `application/problem+json`. Mensagens internas e stacks nunca são devolvidas. As respostas expõem somente código estável, título, detalhe seguro, status e, quando válido, o UUIDv7 de correlação. O endpoint de readiness preserva seu corpo operacional para permitir diagnóstico de dependências.

## Rate limiting

O contador usa `INCR` e `PEXPIRE` no mesmo script Lua do Redis, portanto requisições concorrentes não conseguem ultrapassar o limite por uma condição de corrida. A identidade do cliente é armazenada somente como SHA-256; o endereço bruto não faz parte da chave.

| Classe | Padrão por 60 s | Falha do Redis |
|---|---:|---|
| mutações de autenticação | 10 | fail closed, HTTP 503 |
| demais mutações | 30 | fail closed, HTTP 503 |
| leituras | 120 | fail open e evento de degradação |
| health, readiness e preflight | isento | isento |

Os limites e a janela podem ser ajustados pelas variáveis `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_MUTATION_MAX`, `RATE_LIMIT_GENERAL_MAX` e `RATE_LIMIT_WINDOW_MS`. Respostas limitadas usam HTTP 429, `Retry-After`, `X-RateLimit-Limit` e `X-RateLimit-Remaining`.

O fail open de leituras mantém consultas disponíveis durante uma falha transitória do Redis. Operações que alteram estado falham fechadas para evitar abuso não contabilizado. PostgreSQL e a outbox continuam sendo a autoridade durável; o Redis não se torna fonte de verdade.

## Logs e segredos

API, autenticação e bootstrap registram somente campos estruturados aprovados. A sanitização recursiva remove cookies, tokens, senhas, e-mails, credenciais S3, assinaturas e URLs assinadas. Objetos `Error` não registram mensagem nem stack. Paths de autenticação perdem query string e fragmento antes do log.

Credenciais reais não pertencem ao repositório. `.env.example` contém apenas valores locais fictícios, e URLs assinadas devem permanecer somente em memória e nas respostas autorizadas.

## Matriz de exposição

| Componente | Porta padrão | Exposição admitida | Observação |
|---|---:|---|---|
| web | 3000 | pública por TLS | único frontend de produto |
| API HTTP/Socket.IO | 3001 | pública por TLS/proxy | rotas sob `/v1`; aplicação não confia em proxy por padrão |
| probes do worker | 3002 | loopback/rede operacional | nenhuma rota de produto |
| PostgreSQL | 5432 | loopback local/rede privada | nunca publicar na internet |
| Redis | 6379 | loopback local/rede privada | nunca publicar na internet |
| S3-compatible | 9000 | loopback local/rede privada | objetos privados; acesso externo somente por URL assinada curta |

No Compose local, as dependências são vinculadas a `127.0.0.1`. Em produção, firewall ou security group deve permitir PostgreSQL, Redis, armazenamento e probes apenas entre os processos autorizados. Console administrativo do armazenamento não faz parte da superfície da aplicação.
