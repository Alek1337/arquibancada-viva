# Fronteiras de dependência

O monorepo usa aliases `@arquibancada-viva/*` e uma direção única de dependências.

```text
apps/web    -> ui, contracts, config/client
apps/api    -> auth, contracts, database, game-core, config
apps/worker -> auth, contracts, database, game-core, config

auth      -> database, config
database  -> config
ui        -> contracts
contracts -> nenhuma dependência interna
config    -> nenhuma dependência interna
game-core -> nenhuma dependência interna ou de infraestrutura
testing   -> pacotes compartilhados, nunca apps
```

## Regras verificadas

- Nenhum pacote pode importar código de `apps/*`.
- Aplicações não podem importar umas às outras.
- Imports entre workspaces devem usar o alias público, nunca um caminho relativo que escape do workspace.
- Subcaminhos só são válidos quando declarados explicitamente no campo `exports` do pacote; curingas são proibidos.
- Dependências internas em `package.json` devem usar `workspace:*` e respeitar o grafo acima.
- `game-core` não pode importar módulos nativos do Node nem bibliotecas de framework, banco, Redis, filas, sockets, autenticação ou nuvem.
- A web não pode importar drivers de banco, Redis, filas ou armazenamento de objetos.

Execute `pnpm lint:boundaries` para validar o repositório. O teste `pnpm test:boundaries` também executa uma fixture propositalmente inválida e comprova que uma importação de infraestrutura pelo `game-core` é rejeitada.
