# Arquibancada Viva

Jogo social de arquibancada em tempo real para navegador.

## Estado

A fundação técnica está na fase Execute. Os artefatos internos de planejamento e especificação são mantidos fora do histórico público por enquanto.

## Pré-requisitos

- Node.js 24.14.1
- pnpm 11.19.0
- Docker Desktop com backend WSL 2 no Windows, ou Docker Engine com Compose v2 no Linux.

## Primeiro checkout

```powershell
git clone https://github.com/Alek1337/arquibancada-viva.git
cd arquibancada-viva
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm dev
```

No Linux/macOS, use `cp .env.example .env` no lugar de `Copy-Item`. Abra a web em `http://127.0.0.1:3000`. Configure as URLs públicas, `AUTH_BASE_URL` e `WEB_ORIGIN` com o mesmo hostname usado no navegador; `localhost` e `127.0.0.1` são origens distintas. Verifique `http://127.0.0.1:3001/v1/ready` e `http://127.0.0.1:3002/ready`, ambos com HTTP 200. Cadastro e comandos atuais são fixtures da fundação; o fluxo de contas do produto será implementado em sua spec.

O [guia operacional](docs/operations.md) reúne shutdown, diagnóstico, release, contêineres e requisitos de staging. O [pipeline](.github/workflows/foundation.yml) roda em pushes para `main`, pull requests e execução manual; a carga completa é opcional na execução manual.

## Comandos-raiz

Os comandos de desenvolvimento e os gates comuns podem ser executados a partir da raiz:

```text
pnpm dev
pnpm build
pnpm auth:schema
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm check
pnpm infra:config
pnpm infra:up
pnpm infra:status
pnpm infra:down
```

As regras públicas de dependência do monorepo estão documentadas em `docs/architecture/dependency-boundaries.md` e são verificadas por `pnpm lint:boundaries`.

O catálogo de variáveis, os pontos de entrada de configuração e a política de versionamento dos contratos estão em `docs/configuration.md`. Copie `.env.example` somente como ponto de partida para o ambiente local.

O fluxo do Docker Compose, suas portas e a política de preservação de volumes estão em `docs/local-development.md`.

O fluxo explícito de migrations, pools e transações PostgreSQL está em `docs/database.md`.

Os comandos e probes dos três processos estão em `docs/applications.md`.

A fundação compartilhada do Better Auth com NestJS/Fastify, PostgreSQL e Socket.IO está em `docs/authentication.md`.

As garantias de idempotência, claim, retry e entrega da outbox estão em `docs/outbox-and-idempotency.md`.

O protocolo Socket.IO de snapshot, replay, deduplicação e degradação sem Redis está em `docs/realtime.md`.

O contrato privado S3-compatible, seus estágios e URLs assinadas estão em `docs/object-storage.md`.

A política HTTP, rate limiting, redaction de logs e matriz de exposição estão em `docs/security.md`.

Os traces, métricas, correlação, captura sanitizada de exceções e limites de shutdown estão em `docs/observability.md`.

O shell conectado, a estratégia PWA, a reconciliação e a matriz de navegadores estão em `docs/web-client.md`.

O harness de integração, E2E, recuperação e carga está em `docs/testing.md`.
