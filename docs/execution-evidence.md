# Evidências de execução da fundação técnica

Data da auditoria: 29 de setembro de 2026. Revisão inicial: `a661d72547809fa4e3ae21aeffa86fa1f0a7371a`. Revisão corrigida e validada: `b9372427ae9e16e4d429c7f1fd44d2b58f91ec3b`.

Revisão após correções do Verify: `01a006b0ff590cdf17f5fe5a14d8a65a569c4c9c`. Parecer independente atual: **CONDITIONAL** pela matriz de navegadores reais pendente. Falhas de sessão e acknowledgement foram corrigidas/reverificadas; auditoria incluída, advisories continuam abertos.

Este registro não declara a fundação concluída nem substitui a verificação independente. Um pipeline verde comprova os checks existentes, não requisitos sem implementação ou teste.

## Execuções reproduzíveis

O workflow [Technical foundation](https://github.com/Alek1337/arquibancada-viva/actions/workflows/foundation.yml) usa checkout limpo em Ubuntu 24.04, instalação pelo lockfile e serviços locais descartáveis. A sequência está em [operations.md](operations.md).

- [Execução anterior completa, com carga](https://github.com/Alek1337/arquibancada-viva/actions/runs/36638504789): sucesso na revisão acima; 73 testes unitários, quatro checks de fronteiras, 22 testes integrados, dez cenários de shell em cinco projetos de navegador e uma jornada autenticada com reinício do Redis. Inclui smoke de produção e builds dos três contêineres.
- [Reexecução da auditoria, com carga](https://github.com/Alek1337/arquibancada-viva/actions/runs/36639654945): **sucesso**, job em 4min02s, na mesma revisão. Todos os gates existentes passaram, incluindo dez cenários de shell, jornada com restart Redis e três imagens. Carga: 20 sessões, 155 requisições HTTP totais; p95 de ação 7,75 ms e de evento 105,4 ms; zero falhas de comandos e zero confirmações sem evento.
- [Validação completa após correções](https://github.com/Alek1337/arquibancada-viva/actions/runs/36641144655): **sucesso**, job em 4min28s, revisão `b937242`. Instalação imutável, lint, tipos, 73 testes unitários, quatro de fronteiras, 23 integrados, migrations, builds, smoke de produção, dez cenários de shell, jornada com restart Redis e três imagens passaram. Carga: 20 sessões, 155 requisições HTTP totais; p95 ação **8,51 ms**, evento **100 ms**; zero falhas de comandos e zero confirmações sem evento.
- [Validação final após Verify](https://github.com/Alek1337/arquibancada-viva/actions/runs/36648719864): **sucesso**, job em 5min27s, revisão `01a006b`. Gates completos com auditoria, 81 unitários, sete checks Node (fronteiras/audit), 26 integrados, migrations, builds, smoke, dez cenários de navegador, restart Redis e três imagens. Carga: 20 sessões, 155 HTTP totais, p95 ação **8,35 ms**/evento **104 ms**, zero falhas ou confirmações sem evento. Não é validação do motor competitivo ou ambiente beta.

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

## Resolução da auditoria

O proprietário aprovou em 29/09/2026 corrigir as evidências de migration e HTTP na fundação e transferir as obrigações competitivas para as etapas apropriadas. Isso não dispensa os requisitos antes do lançamento.

- Correção `b937242`: o teste de upgrade aplica as quatro primeiras migrations reais, insere sequence/outbox e verifica a ausência da coluna nova. Depois aplica a quinta, preserva registros e hashes anteriores, confirma a coluna nova utilizável e testa reaplicação sem duplicação. O caso em banco vazio continua obrigatório.
- Supertest 7.3.0 e tipos 7.2.1 são dependências exclusivas de desenvolvimento da API, fixadas no lockfile. A integração testa erros 401/400/409 pelo contrato Problem Details, ausência de efeito de comandos inválidos, dez retries concorrentes com um único evento/sequence e recuperação após restart. Cada caso usa banco temporário próprio; sockets são encerrados mesmo após falha de assertion.
- Localmente passaram instalação imutável offline, `pnpm check`, `pnpm db:check` e `pnpm test:integration`: 73 testes unitários, quatro de fronteiras e 23 integrados. O primeiro build foi bloqueado pelo sandbox Windows; repetição autorizada fora dele passou. Uma falha inicial detectou compartilhamento de outbox entre testes; corrigida com isolamento por caso, sem enfraquecer assertions.
- `game-core` continua scaffold: determinismo, invariantes e snapshot imutável de regras ficam obrigatórios na futura etapa de motor de partidas. Não confundir versão de evento com configuração competitiva.
- Carga do motor real e metas no ambiente-alvo do beta ficam obrigatórias nas etapas de motor/implantação. As metas de 20 jogadores, p95 500 ms/1 segundo permanecem; harness em loopback não comprova o beta.

Com a reexecução completa acima e as transferências aprovadas, o gate de execução está **pronto para Verify**. A feature só poderá ser considerada concluída após verificação independente; nenhum requisito transferido está declarado cumprido.

## Limitações e dívida operacional

- Playwright Chromium/Firefox/WebKit e emulação mobile não comprovam versões estáveis atual/anterior de Chrome, Edge, Firefox e Safari nem aparelhos Android/iOS reais. A matriz de lançamento permanece pendente.
- Firefox privado no Windows apresentou falha SideBySide; o workflow Linux mantém Firefox obrigatório.
- Proteção de branch requer configuração do proprietário; um status falho hoje não impede tecnicamente um push direto a `main`.
- Builds de contêiner e smoke de aplicações não equivalem a deploy, backups ou alta disponibilidade. Provedor, HTTPS, restore, RPO/RTO e staging continuam fora desta execução.
- Harness não implementa filiações, pontuação, XP, moderação, loja ou chat. Está bloqueado em produção por configuração.
- A revisão inicial não executou auditoria de dependências. O Verify identificou a lacuna e ela foi corrigida com `pnpm audit:dependencies` obrigatório no workflow; triagem aberta em [dependency-audit.md](dependency-audit.md). Ausência de falha funcional não é atestado de ausência de vulnerabilidades.
- Specs, decisões e matriz detalhada permanecem locais e fora do histórico público.

## Histórico

### Correções após Verify independente

O Verify inicial reprovou a autorização de sockets existentes após logout. Dois testes novos
reproduziram o problema antes da correção: nova entrada em sala após revogação e após expiração
persistida. A API agora resolve a mesma sessão de REST em cada `match:join`; sessão inválida ou
substituída é rejeitada antes de acesso a estado/sala e encerra a namespace. Erro de consulta
também falha fechado. Testes unitários cobrem falha de consulta e identidade substituída; as
regressões reais passaram após a alteração. A revisão independente deve confirmar a correção,
não confiar apenas neste relato do executor.

A auditoria faltante agora distingue advisories (reportados para triagem) de erro de consulta
(gate falha). Quatro advisories iniciais continuam abertos para atualização/análise, sem
dispensa de produção. A matriz de navegadores reais ainda não foi completada nem dispensada.

Uma segunda reprodução independente detectou acknowledgement malformado que produzia
rejeição não tratada. Correção `01a006b`: validação do argumento como função, rejeição
estruturada para valores malformados e proteção final de Promise. Quatro casos unitários
falharam antes do fix e passaram depois. Integração e diagnóstico independente sem observer
global confirmaram rejeição de string/número/objeto/null, seguida de join válido e health 200.
O revisor encerrou os achados de sessão, audit e acknowledgement. Parecer atual **CONDITIONAL**
pela matriz de browsers reais pendente, não aprovação integral da feature nem do lançamento.

Os commits anteriores permanecem preservados. A etapa de pipeline precisou de dois commits: a execução Linux revelou expansão de globs diferente do PowerShell, corrigida em `a661d72` após `33ab811`. A auditoria inicial foi registrada em `cc744fc`; correções de testes/dependências em `b937242`. O registro final de evidência é separado da correção para poder citar a revisão efetivamente validada. Não foram alterados schema, regras do jogo, infraestrutura ou proteção de branch.
