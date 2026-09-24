# Aplicações

O monorepo possui três processos com responsabilidades separadas:

- `web`: Next.js 16 App Router, sem acesso direto a PostgreSQL, Redis ou segredos.
- `api`: NestJS/Fastify, porta autoritativa HTTP sob o prefixo `/v1`.
- `worker`: processo Node.js sem interface de produto; expõe somente probes operacionais.

## Execução local

Copie `.env.example` para `.env`, suba as dependências e aplique as migrations antes de iniciar os processos:

```text
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Também é possível iniciar um processo isolado com `pnpm dev:web`, `pnpm dev:api` ou `pnpm dev:worker`. Após `pnpm build`, os artefatos de produção iniciam com `pnpm start:web`, `pnpm start:api` e `pnpm start:worker`.

## Health e readiness

| Processo | Liveness | Readiness | Dependência verificada |
|---|---|---|---|
| web | `GET /health` | `GET /ready` | configuração pública válida |
| API | `GET /v1/health` | `GET /v1/ready` | PostgreSQL, Redis e S3-compatible |
| worker | `GET /health` | `GET /ready` | PostgreSQL, Redis e S3-compatible |

Liveness indica que o processo está vivo. Readiness retorna HTTP 503 quando uma dependência obrigatória não responde; isso permite retirar o processo de tráfego sem confundir a falha com crash. O worker faz bind somente em loopback no desenvolvimento e não oferece rotas de produto.

API e worker validam toda a configuração antes de abrir portas. Ambos deixam de aceitar trabalho novo e fecham pools, clientes S3, listeners e exportadores de telemetria no encerramento gracioso, limitado por `SHUTDOWN_TIMEOUT_MS`. Em Windows, `SIGINT` é o caminho local confiável; contêineres Linux usam `SIGTERM`.

Os dois processos também propagam o identificador de correlação entre HTTP, outbox, jobs e sockets. A configuração dos exportadores e o catálogo de métricas estão em [Observabilidade](./observability.md).

## Builds e contêineres

`pnpm build` gera o standalone do Next.js e bundles ESM iniciáveis da API e do worker. Com as dependências locais saudáveis, `pnpm test:smoke` inicia os três builds, consulta health/readiness e os encerra.

Os Dockerfiles usam o contexto da raiz:

```text
docker build -f apps/web/Dockerfile -t arquibancada-viva-web .
docker build -f apps/api/Dockerfile -t arquibancada-viva-api .
docker build -f apps/worker/Dockerfile -t arquibancada-viva-worker .
```

As imagens não executam migrations no boot. Esse passo continua sendo uma ação explícita de release com `pnpm db:migrate`.
