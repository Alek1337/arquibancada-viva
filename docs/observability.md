# Observabilidade e lifecycle

API e worker usam `@arquibancada-viva/observability` como fronteira única para traces, métricas e captura de exceções. O pacote não contém regra de negócio e os adaptadores externos são opcionais: sem configuração, a instrumentação opera em modo no-op; com configuração, exporta OTLP por HTTP e eventos sanitizados ao Sentry.

## Configuração

- `OTEL_EXPORTER_OTLP_ENDPOINT` habilita traces e métricas OTLP. Informe a URL-base do collector, por exemplo `http://collector.internal:4318`; o runtime acrescenta `/v1/traces` e `/v1/metrics`.
- `SENTRY_DSN` habilita captura de exceções. A integração não envia PII por padrão, não recebe o erro original e aceita somente código seguro e contexto tipado.
- `OBSERVABILITY_EXPORT_TIMEOUT_MS` limita cada tentativa de exportação; padrão de 2 segundos.
- `SHUTDOWN_TIMEOUT_MS` limita a drenagem de servidor, consumers, conexões e exportadores; padrão de 10 segundos.

Falha ao importar, iniciar, registrar ou encerrar um exportador é absorvida pela fronteira de observabilidade. Nenhuma operação competitiva, transação ou publicação usa sucesso de telemetria como condição de commit.

## Correlação

| Etapa | Campos |
|---|---|
| HTTP | `correlationId`, método, rota sem query e status |
| ação futura | `correlationId`, `actionId`, `matchId`, resultado |
| outbox | `correlationId`, `eventId`, `matchId`, `sequence` |
| job | `correlationId`, `jobId`, nome e tentativa |
| Socket.IO | `socketId`, `userId` autenticado e `matchId` ao entrar na sala |

`correlationId` é persistido opcionalmente na outbox e já faz parte do contrato dos jobs. IDs e códigos são propagados como atributos; payloads, cookies, e-mails, tokens, URLs assinadas e mensagens de erro não são enviados. Rotas perdem query string e fragmento antes da exportação.

## Métricas iniciais

| Métrica | Tipo | Unidade/atributos principais |
|---|---|---|
| `http.server.duration` | histograma | ms, rota, método e status |
| `game.actions` | contador | `accepted` ou `rejected`; ativado quando as rotas de ação forem implementadas |
| `outbox.delivery.delay` | histograma | ms entre `occurredAt` e publicação |
| `socket.connections` | up/down counter | conexão e desconexão |
| `worker.jobs` | contador | `completed` ou `failed`, nome e tentativa |
| `db.client.connections` | histograma de snapshots | `total`, `idle` e `waiting` durante readiness |

As métricas de latência e propagação permitem medir as metas p95 quando o harness de carga da TFT-016 estiver disponível. Elas não declaram que a meta já foi atingida.

## Encerramento

Ao receber o sinal de encerramento, API e worker param de aceitar tráfego ou probes, drenam Socket.IO, BullMQ, outbox e conexões, e por último tentam descarregar telemetria. A operação inteira é limitada por `SHUTDOWN_TIMEOUT_MS`; exceder esse limite produz falha explícita de shutdown em vez de manter o processo indefinidamente aberto.
