# Outbox e idempotência

Esta fundação mantém o PostgreSQL como fonte durável e usa entrega **ao menos uma vez**. A publicação pode se repetir, mas conserva o mesmo `eventId`; consumidores devem deduplicar por esse identificador.

## Comandos idempotentes

`executeIdempotentCommand` executa o efeito, grava a resposta e registra a outbox dentro da mesma transação. Chamadas simultâneas com a mesma chave e escopo aguardam a constraint única e recebem a mesma resposta persistida. A mesma chave com conteúdo diferente retorna `IDEMPOTENCY_KEY_CONFLICT`.

- A chave é opaca, deve possuir de 8 a 200 caracteres e nunca é persistida em claro; somente SHA-256 é armazenado.
- O escopo deve identificar o tipo do comando e seu limite de colisão, normalmente incluindo ator ou agregado.
- O conteúdo da requisição é canonicalizado antes do hash para não depender da ordem de propriedades JSON.
- A retenção padrão é de 24 horas. `expiresAt` torna o registro elegível para `deleteExpiredIdempotencyRecords`; enquanto o registro existir, a chave não é reutilizada.
- A limpeza deve considerar a maior janela em que o cliente pode repetir uma requisição. Após excluir o registro expirado, a mesma chave poderá representar uma nova execução.

## Outbox

`recordOutboxMessage` deve ser chamado dentro da mesma transação do efeito. Depois do commit, `dispatchNow(eventId)` faz a tentativa rápida. Falha de publicação retorna `deferred` e não desfaz nem esconde o comando confirmado.

O worker usa `createOutboxRecovery` para buscar lotes sem sobreposição. O claim usa `FOR UPDATE SKIP LOCKED`, incrementa `attempts` e transforma `nextAttemptAt` em um lease de publicação. O padrão é:

- lote de 50 mensagens;
- poll a cada 1 segundo;
- lease de 30 segundos;
- até 10 tentativas;
- backoff exponencial a partir de 1 segundo, limitado a 5 minutos.

Uma execução interrompida deixa o registro em `publishing`; quando o lease vence, outro worker pode reivindicá-lo. Após o limite de tentativas, o registro permanece em `failed` e observável, sem novo claim automático.

O publisher concreto para Socket.IO será ligado na TFT-011. A TFT-010 fornece a porta de publicação, a tentativa rápida e o recovery worker sem assumir o transporte final.
