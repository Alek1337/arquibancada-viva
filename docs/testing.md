# Harness de integração, E2E e carga

A validação da fundação usa exclusivamente alvos locais. `@arquibancada-viva/testing` recusa PostgreSQL, Redis e URLs HTTP que não estejam em loopback, cria bancos efêmeros com nome único e os remove no encerramento. O endpoint `POST /v1/technical/matches/:matchId/actions` só é registrado quando `TECHNICAL_HARNESS_ENABLED=true`; a configuração rejeita essa flag em `NODE_ENV=production`.

## Camadas

- `pnpm test` cobre lógica pura, contratos e fronteiras sem rede.
- `pnpm test:integration` cria bancos PostgreSQL efêmeros, usa prefixos Redis exclusivos e cobre auth, Socket.IO, idempotência, outbox e recuperação após reinício de API/publicador.
- `pnpm --filter @arquibancada-viva/web test:e2e:foundation` inicia API, worker e web contra a infraestrutura local, cria sessão própria, sincroniza uma partida, confirma uma ação pela API, recebe o evento e reconcilia após offline/online.
- `pnpm test:load` executa k6 com 20 sessões autenticadas. A métrica `technical_action_response_ms` mede a resposta HTTP; `technical_event_propagation_ms` mede separadamente o tempo entre `committedAt` e o evento Socket.IO correspondente.

## Preparação local

```powershell
pnpm infra:up
pnpm db:migrate
pnpm test:integration
$env:FOUNDATION_RESTART_REDIS = "1"
pnpm --filter @arquibancada-viva/web test:e2e:foundation
```

Para carga, mantenha API e worker iniciados com o harness habilitado, gere um UUIDv7 e passe-o explicitamente ao k6:

```powershell
$env:TECHNICAL_HARNESS_ENABLED = "true"
pnpm dev:api
pnpm dev:worker
$env:TECHNICAL_MATCH_ID = pnpm --silent test:load:seed
pnpm test:load
```

O cenário usa exatamente 20 VUs, cooldown técnico padrão de 3 segundos, cerca de 22 segundos de atividade por sessão e falha se houver comando confirmado sem evento, erro de comando, p95 HTTP acima de 500 ms ou p95 de propagação acima de 1 segundo. `TARGET_API_URL` aceita apenas `localhost` ou `127.0.0.1` nesta fundação.

Os números medem a infraestrutura técnica, não o futuro match engine. A feature de partida deverá repetir a carga com regras, cooldown e ação reais antes do beta.

## Recuperação

A suíte integrada prova que efeitos confirmados permanecem no PostgreSQL após reinício da API e do caminho de publicação. Durante a carga local, `docker compose restart redis` pode ser usado para provar reconexão do transporte: respostas já confirmadas permanecem na outbox e são publicadas pelo worker após o Redis voltar; clientes recuperam a sequência por replay ou snapshot. A TFT-016 registra separadamente a execução medida e qualquer limitação do host.
