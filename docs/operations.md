# Operação da fundação técnica

## Validação reproduzível

Use Node 24.14.1, pnpm 11.19.0 e Docker com Compose. Em checkout limpo:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm db:check
pnpm infra:config
pnpm infra:up
pnpm db:migrate
pnpm test:integration
pnpm test:smoke
pnpm --filter @arquibancada-viva/web exec playwright install --with-deps chromium firefox webkit
pnpm test:e2e
pnpm test:e2e:foundation
```

Para testar a recuperação real do Redis, defina `FOUNDATION_RESTART_REDIS=1` antes da jornada integrada. No PowerShell: `$env:FOUNDATION_RESTART_REDIS = '1'`; no Bash: `FOUNDATION_RESTART_REDIS=1 pnpm test:e2e:foundation`. O teste exige uso exclusivo do Redis local durante o reinício.

O workflow `Technical foundation` reproduz essa sequência em Ubuntu 24.04, com permissões `contents: read`, actions fixadas por SHA, credenciais fictícias locais e nenhuma credencial de produção. Nenhum gate usa `continue-on-error`. Os testes negativos de fronteiras verificam que imports proibidos retornam código 1. Os estados de PR são informativos até que o proprietário configure proteção de branch para exigir o job `foundation`.

A carga exige infraestrutura saudável e portas 3001/3002 livres. Instale k6 2.2.0 e execute `pnpm test:load:local`: o runner inicia API/worker, cria uma partida técnica, executa 20 sessões e encerra seus processos. `K6_BINARY` pode apontar para o executável. Em Linux com Docker, `K6_DOCKER=1 pnpm test:load:local` usa a imagem `grafana/k6:2.2.0` com rede do host. O workflow manual oferece `run_load=true` para essa etapa; thresholds falhos retornam código não zero. A medição deve ser repetida para o match engine e em hardware de staging.

Cookies e fixtures do Playwright ficam em `apps/web/test-results`, ignorados pelo Git e pelo contexto Docker. O pipeline não publica esses arquivos, traces ou dumps de ambiente como artifacts. Logs estruturados de aplicação aplicam redaction; não use `printenv`, `set -x` ou URLs com credenciais em comandos de diagnóstico.

## Portas, persistência e encerramento

| Serviço | Porta local | Persistência |
|---|---|---|
| Web | 3000 | build local |
| API | 3001 | PostgreSQL autoritativo |
| Worker probes | 3002 | PostgreSQL/outbox |
| PostgreSQL | 5432 | `arquibancada-viva-postgres-data` |
| Redis | 6379 | `arquibancada-viva-redis-data` |
| S3-compatible | 9000 | `arquibancada-viva-storage-data` |

O Compose publica dependências apenas em loopback e usa a rede `arquibancada-viva-platform`. `COMPOSE_PROJECT_NAME` altera os nomes da rede/volumes. Portas e credenciais podem ser ajustadas em `.env`; mantenha as URLs de consumidores coerentes.

Interrompa `pnpm dev` com Ctrl+C antes de `pnpm infra:down`. O comando encerra os serviços sem remover volumes. API/worker drenam listeners e conexões dentro de `SHUTDOWN_TIMEOUT_MS`. Use SIGTERM no Linux e SIGINT no Windows. Não há script padrão que remova os dados locais; qualquer descarte de volumes deve ser uma ação explícita do operador com backup prévio.

## Diagnóstico

| Sintoma | Inspeção e correção |
|---|---|
| Docker não responde | `docker version`; confirme que o Desktop/WSL 2 está iniciado. Atualize pelo instalador oficial se houver falha de socket. Factory reset apaga dados e não é rotina de recuperação. |
| Porta ocupada | `pnpm infra:status`; identifique o processo responsável antes de mudar a porta. Ajuste também DATABASE_URL, REDIS_URL ou S3_ENDPOINT. |
| Readiness 503 | `pnpm infra:status` e `pnpm infra:logs`; verifique PostgreSQL, Redis, bucket privado e credenciais. Liveness 200 não significa readiness. |
| Tabela inexistente | Execute `pnpm db:check` e `pnpm db:migrate` com o DATABASE_URL correto. Migrations nunca rodam no boot. |
| S3 rejeita autenticação | Compare ACCESS_KEY/SECRET_KEY da aplicação e Compose; para RustFS local use `S3_FORCE_PATH_STYLE=true`. |
| Sessão/origem recusada | Use o mesmo hostname em WEB_ORIGIN, AUTH_BASE_URL e URLs públicas. |
| Playwright sem runtime | Reexecute `playwright install --with-deps` pelo workspace web. No Windows, o Firefox privado pode falhar com SideBySide; CI Linux mantém os cinco projetos obrigatórios. |
| Build mudou next-env | Next gera caminhos diferentes no modo dev; execute o build antes de validar o artefato de produção. |

## Contêineres e staging

Os builds usam a raiz do repositório:

```text
docker build -f apps/web/Dockerfile -t arquibancada-viva-web:local .
docker build -f apps/api/Dockerfile -t arquibancada-viva-api:local .
docker build -f apps/worker/Dockerfile -t arquibancada-viva-worker:local .
```

Forneça `--build-arg NEXT_PUBLIC_API_URL=https://api.example.invalid` e `--build-arg NEXT_PUBLIC_SOCKET_URL=https://api.example.invalid` ao build web: essas URLs são incorporadas ao bundle. API e worker recebem configuração privada no runtime. O contexto exclui `.env`, specs, outputs, dependências e resultados de teste.

Staging exige uma instância web/API/worker, reverse proxy HTTPS com upgrade WebSocket, origem exata, PostgreSQL com backup e restauração testada, Redis privado e bucket S3 privado. Banco, Redis, storage e probes não devem ter exposição pública. Configure segredos fora das imagens, limites dos pools, grace period maior que o timeout de shutdown, health/readiness e exportadores opcionais. `NODE_ENV=production` rejeita `TECHNICAL_HARNESS_ENABLED=true`; medições do harness usam um ambiente técnico separado.

Uma release aplica migrations revisadas com `pnpm db:migrate` como passo explícito antes de liberar tráfego aos builds compatíveis. Registre commit/tag de cada imagem e verifique readiness. Reverter a imagem exige compatibilidade com o schema atual; migrations seguem roll-forward e não há downgrade automático. Provedor, domínio, custos e credenciais de staging serão definidos na spec de implantação do beta.
