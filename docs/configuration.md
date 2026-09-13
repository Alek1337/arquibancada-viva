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
| `NEXT_PUBLIC_API_URL` | web | sim | URL HTTP(S) pública da API |
| `NEXT_PUBLIC_SOCKET_URL` | web | sim | URL HTTP(S) pública do Socket.IO |
| `API_PORT` | API | não | inteiro entre 1 e 65535; padrão 3001 |
| `WEB_ORIGIN` | API | sim | origem HTTP(S) aceita pela API |
| `AUTH_SECRET` | API | sim | segredo com no mínimo 32 caracteres |
| `DATABASE_URL` | API/worker | sim | URL `postgres://` ou `postgresql://` |
| `REDIS_URL` | API/worker | sim | URL `redis://` ou `rediss://` |
| `S3_ENDPOINT` | API/worker | sim | endpoint do armazenamento compatível com S3 |
| `S3_REGION` | API/worker | sim | região configurada no cliente S3 |
| `S3_BUCKET` | API/worker | sim | bucket privado ou de quarentena |
| `S3_ACCESS_KEY_ID` | API/worker | sim | identificador de acesso; nunca registrar em log |
| `S3_SECRET_ACCESS_KEY` | API/worker | sim | segredo com no mínimo 32 caracteres; nunca registrar em log |
| `WORKER_CONCURRENCY` | worker | não | inteiro de 1 a 100; padrão 5 |

O arquivo `.env.example` contém somente valores locais fictícios. Credenciais reais permanecem fora do Git.

## Erros e versionamento de contratos

Erros públicos seguem Problem Details e usam códigos estáveis em `UPPER_SNAKE_CASE`. Adicionar um código é compatível; remover, renomear ou alterar sua semântica exige versão nova ou plano explícito de migração.

Eventos usam envelope `version: 1`, UUIDv7 para `eventId` e `matchId`, `sequence` positiva por partida e `occurredAt` ISO 8601 em UTC. Mudança incompatível exige um novo número de versão e convivência durante a migração.
