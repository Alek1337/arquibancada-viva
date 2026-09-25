# Cliente web e PWA

O shell do beta usa Next.js App Router, Tailwind CSS e primitives acessíveis de `@arquibancada-viva/ui`. O manifesto, os ícones provisórios próprios e o service worker formam a base instalável. O service worker não possui handler de `fetch`: respostas REST, handshakes Socket.IO e comandos competitivos nunca são obtidos de cache offline.

## Estados de conexão

`idle → connecting → reconciling → ready` é o único caminho que habilita uma ação sensível. Ao reconectar, detectar lacuna de `sequence`, receber payload inválido ou ficar offline, o cliente sai imediatamente de `ready` e desabilita as quatro ações. Um novo join sem cursor exige snapshot autoritativo e acknowledgement compatível antes de retornar a `ready`.

O cliente REST valida `/v1/me/session` com o contrato público de identidade antes de abrir o canal. Eventos, snapshots e respostas do join também são validados por `@arquibancada-viva/contracts`; payload inválido não é aplicado à projeção.

## Compatibilidade e acessibilidade

A experiência essencial tem como matriz as versões estáveis corrente e imediatamente anterior de Chrome, Edge, Firefox e Safari, além de Chrome Android e Safari iOS. O smoke automatizado cobre Chromium, Firefox, WebKit e emulações Android/iOS; a matriz de versões reais será ampliada pelo harness da TFT-016.

O projeto Firefox permanece habilitado por padrão. `PLAYWRIGHT_SKIP_FIREFOX=1` existe somente para hosts onde o binário privado do Playwright não pode iniciar; nesses ambientes, o Firefox instalado no sistema deve receber um smoke separado e a limitação precisa ser registrada no resultado.

- O primeiro `Tab` revela o link de salto para a partida.
- Links, botões e campos recebem foco visível com contraste alto.
- Estados usam texto, símbolo e semântica `status`/`alert`, sem depender apenas de cor.
- Controles nativos preservam `disabled`, nomes acessíveis e alvos de pelo menos 44 px.
- Animações são reduzidas quando `prefers-reduced-motion` está ativo.
