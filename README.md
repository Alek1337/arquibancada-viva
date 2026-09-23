# Arquibancada Viva

Jogo social de arquibancada em tempo real para navegador.

## Estado

A fundação técnica está na fase Execute. Os artefatos internos de planejamento e especificação são mantidos fora do histórico público por enquanto.

## Pré-requisitos

- Node.js 24.14.1
- pnpm 11.19.0

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
