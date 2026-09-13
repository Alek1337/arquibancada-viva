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
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm check
```

Aplicações e pacotes serão adicionados pelas próximas tarefas da fundação técnica.

As regras públicas de dependência do monorepo estão documentadas em `docs/architecture/dependency-boundaries.md` e são verificadas por `pnpm lint:boundaries`.
