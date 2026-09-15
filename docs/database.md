# Banco de dados e migrations

`packages/database` é a única fronteira autorizada para acesso ao PostgreSQL. O pacote contém o schema Drizzle code-first, factories de conexão, limites transacionais e migrations SQL versionadas.

## Organização

- `auth`: tabelas `user`, `session`, `account` e `verification` geradas para o Better Auth.
- `app`: dados duráveis do jogo; a fundação começa com sequence por partida e outbox mínima.
- `drizzle`: controle interno das migrations aplicadas.

IDs públicos são UUIDv7 gerados na aplicação. Instantes são armazenados em `timestamp with time zone`. A sequence cresce por partida com `INSERT ... ON CONFLICT DO UPDATE` dentro da transação que também grava o evento.

## Pools e transações

A API e o worker criam pools independentes, identificados por `application_name`. Os limites padrão são, respectivamente, 10 e 5 conexões e podem ser alterados por `API_DATABASE_POOL_MAX` e `WORKER_DATABASE_POOL_MAX`. Migrations usam um terceiro pool com uma conexão.

`withTransaction` aplica `lock_timeout` de 2 segundos e `statement_timeout` de 5 segundos somente à transação. Chamadas externas não devem acontecer enquanto ela estiver aberta.

## Fluxo de migration

Com a infraestrutura saudável e um `.env` local baseado em `.env.example`:

```text
pnpm auth:schema
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm test:integration
```

`auth:schema` regenera somente o schema Drizzle da biblioteca oficial. `db:generate` altera migrations versionadas, então o SQL e o snapshot devem ser revisados. `db:migrate` é uma ação explícita de release/operação; nenhuma aplicação executa migration durante o boot. `drizzle-kit push` não faz parte do fluxo aprovado.

O projeto usa roll-forward: uma migration já compartilhada não é editada nem revertida automaticamente. Correções são novas migrations aditivas. SQL com `DROP TABLE`, `DROP SCHEMA`, `DROP COLUMN` ou `TRUNCATE TABLE` falha no gate, salvo quando inclui `-- destructive-transition: <plano revisado>` e possui estratégia de transição aprovada.

O teste de integração cria bancos temporários isolados, valida banco vazio, reaplicação, estado anterior suportado e rollback atômico, e então remove esses bancos. Ele nunca apaga o banco configurado em `DATABASE_URL`.
