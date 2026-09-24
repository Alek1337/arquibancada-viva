# Configuração

Os processos recebem um objeto de ambiente e o validam antes de aceitar tráfego ou jobs. Os parsers não leem `process.env` diretamente, o que permite testes determinísticos e evita misturar variáveis de processos diferentes.

## Entradas públicas

| Import | Consumidor | Conteúdo |
|---|---|---|
| `@arquibancada-viva/config` | API, worker e tooling | tipos e enums comuns sem segredos |
| `@arquibancada-viva/config/client` | web | somente variáveis `NEXT_PUBLIC_*` |
| `@arquibancada-viva/config/api` | API | rede, banco, Redis, autenticação e armazenamento |
| `@arquibancada-viva/config/worker` | worker | banco, Redis, armazenamento e concorrência |

O gate de fronteiras rejeita qualquer tentativa da web de importar `config/api` ou `config/worker`.

## Variáveis

| Variável | Processo | Obrigatória | Regra |
|---|---|---:|---|
| `NODE_ENV` | API/worker | não | `development`, `test` ou `production`; padrão `development` |
| `LOG_LEVEL` | API/worker | não | nível estruturado; padrão `info` |
| `OBSERVABILITY_EXPORT_TIMEOUT_MS` | API/worker | não | timeout de exportação entre 100 ms e 30 s; padrão 2000 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | API/worker | não | URL-base HTTP(S) do collector OTLP; ausente mantém adapter no-op |
| `SENTRY_DSN` | API/worker | não | DSN HTTP(S) do projeto; ausente desabilita captura externa |
| `SHUTDOWN_TIMEOUT_MS` | API/worker | não | limite de drenagem entre 1 s e 60 s; padrão 10000 |
| `NEXT_PUBLIC_API_URL` | web | sim | URL HTTP(S) pública da API |
| `NEXT_PUBLIC_SOCKET_URL` | web | sim | URL HTTP(S) pública do Socket.IO |
| `API_HOST` | API | não | interface de bind; `127.0.0.1` local ou `0.0.0.0` no contêiner |
| `API_PORT` | API | não | inteiro entre 1 e 65535; padrão 3001 |
| `API_BODY_LIMIT_BYTES` | API | não | limite global do corpo HTTP, entre 1 KiB e 1 MiB; padrão 65536 |
| `WEB_ORIGIN` | API | sim | origem HTTP(S) aceita pela API |
| `AUTH_BASE_URL` | API | sim | URL HTTP(S) pública da API usada pelo Better Auth |
| `AUTH_SECRET` | API | sim | segredo com no mínimo 32 caracteres |
| `DATABASE_URL` | API/worker | sim | URL `postgres://` ou `postgresql://` |
| `API_DATABASE_POOL_MAX` | API | não | limite do pool PostgreSQL da API; padrão 10 |
| `WORKER_DATABASE_POOL_MAX` | worker | não | limite do pool PostgreSQL do worker; padrão 5 |
| `REDIS_URL` | API/worker | sim | URL `redis://` ou `rediss://` |
| `RATE_LIMIT_AUTH_MAX` | API | não | mutações de autenticação por janela; padrão 10 |
| `RATE_LIMIT_GENERAL_MAX` | API | não | leituras por janela; padrão 120 |
| `RATE_LIMIT_MUTATION_MAX` | API | não | demais mutações por janela; padrão 30 |
| `RATE_LIMIT_WINDOW_MS` | API | não | janela do rate limiter entre 1 s e 1 h; padrão 60000 |
| `POSTGRES_PORT` | Compose | não | porta loopback do PostgreSQL; padrão 5432 |
| `REDIS_PORT` | Compose | não | porta loopback do Redis; padrão 6379 |
| `S3_ENDPOINT` | API/worker | sim | endpoint do armazenamento compatível com S3 |
| `S3_PORT` | Compose | não | porta loopback do endpoint S3; padrão 9000 |
| `S3_REGION` | API/worker | sim | região configurada no cliente S3 |
| `S3_BUCKET` | API/worker | sim | bucket privado ou de quarentena |
| `S3_ACCESS_KEY_ID` | API/worker | sim | identificador de acesso; nunca registrar em log |
| `S3_SECRET_ACCESS_KEY` | API/worker | sim | segredo com no mínimo 32 caracteres; nunca registrar em log |
| `S3_FORCE_PATH_STYLE` | API/worker | não | `true` no RustFS local; use `false` quando o provedor exigir virtual host style |
| `WORKER_CONCURRENCY` | worker | não | inteiro de 1 a 100; padrão 5 |
| `WORKER_PROBE_HOST` | worker | não | interface do servidor operacional; padrão `127.0.0.1` |
| `WORKER_PROBE_PORT` | worker | não | porta interna de health/readiness; padrão 3002 |

O arquivo `.env.example` contém somente valores locais fictícios. Credenciais reais permanecem fora do Git.

## Erros e versionamento de contratos

Erros públicos seguem Problem Details e usam códigos estáveis em `UPPER_SNAKE_CASE`. Adicionar um código é compatível; remover, renomear ou alterar sua semântica exige versão nova ou plano explícito de migração.

Eventos usam envelope `version: 1`, UUIDv7 para `eventId` e `matchId`, `sequence` positiva por partida e `occurredAt` ISO 8601 em UTC. Mudança incompatível exige um novo número de versão e convivência durante a migração.
