# Fundação de tempo real

A API expõe as namespaces Socket.IO `/auth` e `/matches` no mesmo servidor HTTP. As duas
resolvem a sessão persistida do Better Auth durante o handshake. No beta, a autorização de uma
sala exige uma sessão válida e a existência técnica da partida; regras de produto mais restritas
podem substituir essa decisão sem alterar o protocolo de recuperação.

## Protocolo da partida

O cliente envia `match:join` com `matchId` e, em uma reconexão, `lastSequence`. A API entra na
sala `match:{matchId}` e responde de uma destas formas:

- `current`: cliente e estado persistido já têm a mesma sequência;
- `replay`: até 100 eventos contíguos são lidos do outbox PostgreSQL e emitidos como
  `match:event.v1`;
- `snapshot`: o cliente não informou cursor, está adiantado, excedeu a janela de replay ou há
  uma lacuna. O evento `match:snapshot.v1` substitui o estado local.

Cada evento tem `eventId` e `sequence`. O cliente descarta `eventId` repetido e sequências já
aplicadas; se a próxima sequência não for exatamente a esperada, solicita nova sincronização. A
recuperação não usa buffers de conexão do Socket.IO: PostgreSQL é a fonte durável.

## Publicação e degradação

O worker publica mensagens confirmadas pelo outbox no canal Redis
`arquibancada-viva:realtime-events:v1`. Cada instância da API assina esse canal e emite somente
para seus clientes locais. O adapter Redis do Socket.IO mantém salas e operações entre instâncias,
mas não é usado como fonte de recuperação.

Se Redis estiver indisponível, a readiness da API fica negativa e clientes conectados à mesma
instância continuam usando o adapter local. Eventos permanecem no outbox e o worker tenta
publicá-los novamente; nenhum estado durável é perdido. Para múltiplas instâncias com polling,
o balanceador deve usar afinidade de sessão. Transporte exclusivamente WebSocket só deve ser
ativado após validação operacional.
