# Pacotes compartilhados

Diretório reservado aos limites reutilizáveis aprovados no Design:

- `auth`
- `config`
- `contracts`
- `database`
- `game-core`
- `observability`
- `storage`
- `testing`
- `ui`

Cada pacote será criado somente pela task responsável.

Pacotes compartilhados usam o namespace `@arquibancada-viva/*`. Consuma somente os caminhos declarados em `exports`; imports profundos acidentais e dependências em direção inversa são rejeitados pelo gate de fronteiras.

O pacote `game-core` é mantido livre de frameworks, rede, armazenamento, relógio do sistema e outras dependências de infraestrutura.
