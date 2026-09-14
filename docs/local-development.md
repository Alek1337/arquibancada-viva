# Desenvolvimento local

As aplicações rodam no Node.js do host. PostgreSQL, Redis e o armazenamento S3-compatible rodam no Docker Compose.

## Pré-requisitos

- Docker Desktop com backend WSL 2 em execução.
- Node.js e pnpm nas versões declaradas no `package.json`.

Confirme a instalação com `docker version` e `docker compose version`. Em uma instalação nova do WSL 2, o Windows pode exigir uma reinicialização antes de iniciar o engine.

## Serviços e portas

| Serviço | Endereço no host | Persistência | Credencial local padrão |
|---|---|---|---|
| PostgreSQL 18 | `127.0.0.1:5432` | volume `arquibancada-viva-postgres-data` | `app` / `app` |
| Redis 8 | `127.0.0.1:6379` | volume `arquibancada-viva-redis-data` | sem senha, somente loopback |
| S3 via RustFS | `http://127.0.0.1:9000` | volume `arquibancada-viva-storage-data` | valores fictícios de `.env.example` |

O RustFS grava os objetos diretamente no volume nomeado. Um serviço auxiliar idempotente cria o bucket `arquibancada-viva-local` quando necessário e aplica bloqueio de acesso público. O console administrativo fica desabilitado e nenhuma porta é publicada em todas as interfaces de rede.

Para alterar uma porta, defina `POSTGRES_PORT`, `REDIS_PORT` ou `S3_PORT` no `.env` local e ajuste também a URL correspondente consumida pelas aplicações. O Docker falha explicitamente se uma porta escolhida já estiver ocupada.

## Comandos seguros

```text
pnpm infra:config
pnpm infra:up
pnpm infra:status
pnpm infra:logs
pnpm infra:down
```

`infra:down` remove contêineres e rede do Compose, mas preserva os três volumes nomeados. Não existe comando padrão para apagar dados. Uma limpeza com remoção de volumes deve ser uma decisão explícita.

`infra:up` aguarda os três health checks e executa a criação idempotente do bucket antes de retornar; portanto, a aplicação não precisa disputar a inicialização do armazenamento.

## Verificação rápida

Após `pnpm infra:up`, `pnpm infra:status` deve mostrar os três serviços como saudáveis. O reinício abaixo deve conservar os dados:

```text
pnpm infra:down
pnpm infra:up
```

As imagens usam tags exatas para evitar atualização acidental. A atualização de cada imagem deve ser feita em uma mudança revisável e seguida do smoke test de persistência.
