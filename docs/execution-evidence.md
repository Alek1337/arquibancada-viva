# Evidências de execução da fundação técnica

Data da auditoria: 29 de setembro de 2026. Revisão de código: `a661d72547809fa4e3ae21aeffa86fa1f0a7371a`.

Este registro não declara a fundação concluída nem substitui a verificação independente. Um pipeline verde comprova os checks existentes, não requisitos sem implementação ou teste.

## Execuções reproduzíveis

O workflow [Technical foundation](https://github.com/Alek1337/arquibancada-viva/actions/workflows/foundation.yml) usa checkout limpo em Ubuntu 24.04, instalação pelo lockfile e serviços locais descartáveis. A sequência está em [operations.md](operations.md).

- [Execução anterior completa, com carga](https://github.com/Alek1337/arquibancada-viva/actions/runs/36638504789): sucesso na revisão acima; 73 testes unitários, quatro checks de fronteiras, 22 testes integrados, dez cenários de shell em cinco projetos de navegador e uma jornada autenticada com reinício do Redis. Inclui smoke de produção e builds dos três contêineres.
- [Reexecução da auditoria, com carga](https://github.com/Alek1337/arquibancada-viva/actions/runs/36639654945): **sucesso**, job em 4min02s, na mesma revisão. Todos os gates existentes passaram, incluindo dez cenários de shell, jornada com restart Redis e três imagens. Carga: 20 sessões, 155 requisições HTTP totais; p95 de ação 7,75 ms e de evento 105,4 ms; zero falhas de comandos e zero confirmações sem evento.

A carga anterior usou 20 sessões, cooldown técnico de três segundos e 155 requisições HTTP totais, incluindo preparação e consultas (não 155 ações competitivas). p95 HTTP de ação: 7,26 ms; p95 evento: 94 ms; sem falhas de comandos ou confirmações sem evento. São medidas do harness em loopback, não do jogo completo ou do ambiente beta. O atraso do evento é medido a partir do timestamp técnico persistido, não por instrumentação direta do instante do commit.

## Cobertura existente

| Capacidade | Evidência no repositório |
|---|---|
| Runtime, lockfile, builds e fronteiras | `package.json`, `pnpm-lock.yaml`, `scripts/check-boundaries.test.mjs`, workflow |
| Configuração validada e segredos sanitizados | testes de config, auth e observability |
| Contratos validados, IDs e UTC | testes de contracts e database/identifiers |
| Persistência e rollback | database integration; API technical harness integration |
| Filas, retry, timeout e idempotência | worker queue integration e processor tests |
| Sessão comum HTTP/socket e revogação | API auth integration |
| Reconciliação, replay e recuperação | API auth/harness integration, worker restart integration, web connection-state/socket tests e E2E |
| Objetos privados e promoção explícita | storage unit/integration |
| Segurança HTTP e degradação controlada | API http-security tests |
| Health, readiness, shutdown e contêineres | production smoke e workflow |
| PWA, offline e componentes-base acessíveis | web shell E2E, connection-state e UI tests |

## Pendências para fechamento

1. `packages/game-core` é um scaffold vazio: isolamento está coberto, determinismo com tempo/RNG explícitos e invariantes do núcleo não estão demonstrados.
2. Não há snapshot imutável de regras de partida. A versão do contrato de evento não comprova imutabilidade de configuração competitiva.
3. O teste chamado “supported previous state” preserva uma tabela auxiliar, mas não instala a penúltima versão das migrations antes de atualizar. Deve ser substituído ou complementado por upgrade real com dados preservados.
4. Os testes HTTP usam `fetch`/injeção Fastify. Supertest, previsto no plano técnico, ainda não integra a suíte. É preciso implementá-lo ou aprovar formalmente a alternativa.
5. Metas de capacidade e latência foram demonstradas apenas para o harness. O motor real e o ambiente-alvo do beta ainda precisam de validação; não há aprovação registrada dispensando essa evidência final.

Não existe desvio aprovado nesta auditoria para encerrar essas pendências. O fechamento deve continuar bloqueado até correção ou decisão explícita de escopo; não foram alteradas regras do produto para satisfazer testes artificiais.

## Limitações e dívida operacional

- Playwright Chromium/Firefox/WebKit e emulação mobile não comprovam versões estáveis atual/anterior de Chrome, Edge, Firefox e Safari nem aparelhos Android/iOS reais. A matriz de lançamento permanece pendente.
- Firefox privado no Windows apresentou falha SideBySide; o workflow Linux mantém Firefox obrigatório.
- Proteção de branch requer configuração do proprietário; um status falho hoje não impede tecnicamente um push direto a `main`.
- Builds de contêiner e smoke de aplicações não equivalem a deploy, backups ou alta disponibilidade. Provedor, HTTPS, restore, RPO/RTO e staging continuam fora desta execução.
- Harness não implementa filiações, pontuação, XP, moderação, loja ou chat. Está bloqueado em produção por configuração.
- A revisão de vulnerabilidades de dependências não foi executada nesta auditoria. Ausência de falha funcional não é atestado de ausência de vulnerabilidades.
- Specs, decisões e matriz detalhada permanecem locais e fora do histórico público.

## Histórico

Os commits anteriores permanecem preservados. A etapa de pipeline precisou de dois commits: a execução Linux revelou expansão de globs diferente do PowerShell, corrigida em `a661d72` após `33ab811`. Este registro é documental e não altera runtime, schema, infraestrutura ou proteção de branch.
