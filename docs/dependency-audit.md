# Auditoria de dependências

Execute `pnpm audit:dependencies` após a instalação imutável. O mesmo comando é obrigatório no workflow. Ele consulta o registry por `pnpm audit --json`, imprime somente IDs, pacote, severidade, versão corrigida e contagens, sem ambiente ou paths de credenciais. Falha de consulta, timeout ou JSON inválido falha o gate: não há `continue-on-error` nem resultado “sem alertas” inventado.

Conforme o Design inicial, advisories são reportados para análise, não bloqueados automaticamente por seu exit code. Isso não os aceita, corrige ou exclui. Não há allowlist silenciosa nem exceção aprovada de produção; o gate não é atestado de segurança. Novos alertas ou mudança de severidade exigem nova triagem e o lançamento exige atualização ou decisão explícita de risco. Não executar `audit --fix` sem revisar mudanças e repetir os testes.

## Triagem inicial — 29/09/2026

Lockfile vigente: três advisories moderados, um baixo, zero altos/críticos. As condições de impacto abaixo são inferências da configuração e do código atuais, não prova de impossibilidade de exploração.

| Advisory e versão instalada | Análise e ação |
|---|---|
| [GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99), esbuild 0.18.20, moderado | Transitive em ferramentas Drizzle/esm-loader. O advisory envolve o servidor `serve` e CORS; nossos scripts usam bundling/migrations, sem servidor esbuild. Não habilitar `serve` com essa versão. Planejar atualização compatível da cadeia legada, sem override major cego. |
| [GHSA-g7r4-m6w7-qqqr](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr), esbuild 0.27.7, baixo | Cadeia de build tsup em API/worker. Impacto envolve `servedir` no Windows; scripts não usam esse modo. Planejar atualização de esbuild/tsup validando builds. |
| [GHSA-w2qp-rph6-63g4](https://github.com/fastify/fastify/security/advisories/GHSA-w2qp-rph6-63g4), Fastify 5.11.3, moderado | Impacto envolve schema de body primitivo com coerção AJV; as fronteiras atuais usam validação Zod explícita de objetos. Atualizar Fastify junto ao adaptador Nest e testar contratos; usar >=5.12.1 indicado nos metadados do advisory/registry, sem depender da descrição textual divergente. |
| [GHSA-3m5p-2c4r-xxw2](https://github.com/fastify/fastify/security/advisories/GHSA-3m5p-2c4r-xxw2), Fastify 5.11.3, moderado | Impacto envolve `trustProxy` numérico e acesso direto à origem; API usa `trustProxy: false`. Não ativar hop-count em staging. Atualizar Fastify/adaptador e revisar proxy antes do lançamento. |

Responsável pela atualização/análise: manutenção do projeto. Estado de todos: **aberto para atualização/triagem**, sem dispensa aprovada. Este commit instala a auditoria faltante, não atualiza essas dependências nem declara os alertas resolvidos. A contagem é temporal e o workflow consulta novamente em cada execução.

## Manutenção prioritária — 30/09/2026

O usuário autorizou priorizar os novos alertas crítico e alto encontrados no preflight do motor. A consulta anterior tinha nove entradas (um crítico, um alto, seis moderados e um baixo); entradas de versões distintas de fast-uri não representam advisories únicos adicionais. Esta manutenção preserva a triagem histórica acima.

| Dependência | Atualização e fonte primária |
|---|---|
| Next.js | 16.3.4 → **16.3.6**, patch divulgado em [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), crítico. Corrige o caminho Node.js ImageResponse/next/og com SVG controlado por atacante. Não reproduzido exploit nesta manutenção. |
| NestJS common/core/platform-fastify | 11.2.3 → **11.2.5**, mantendo os três pacotes alinhados na mesma linha 11. [GHSA-9c5c-9qcx-q35q](https://github.com/nestjs/nest/security/advisories/GHSA-9c5c-9qcx-q35q), alto, informa correção em 11.2.4 e recomenda 11.2.5. O adapter agora depende de @fastify/middie 9.3.4 em lugar do fork afetado. |

Metadados consultados no registry oficial confirmaram peers compatíveis com Node 24, React/React DOM 19.2.8, RxJS 7.8.2 e reflect-metadata 0.2.2 já fixados. Foram usados patches específicos, não `latest`, mudança major, `audit --fix`, override ou allowlist. `pnpm install --no-frozen-lockfile` concluiu com exit 0; o lockfile preserva os demais pacotes fixados e a dependência workspace game-core adicionada pelo desenvolvimento paralelo. O worker não usa Nest e seu manifesto não foi alterado.

Auditoria fresca `pnpm audit:dependencies` após a instalação: consulta **PASS**, sete entradas — **zero críticos, zero altos, seis moderados e um baixo**. Next/Nest não aparecem mais nessa resposta; não é atestado de ausência de vulnerabilidades desconhecidas ou aprovação de produção. Fastify direto e transitivo permanece 5.11.3, conforme dependência exata do adapter 11.2.5; esbuild 0.18.20/0.27.7 permanece inalterado. Os quatro advisories históricos continuam abertos.

Também permanecem abertos os moderados de fast-uri: [GHSA-hrr3-gc8f-f4qj](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj), nas resoluções 3.1.7 e 4.1.4 (patches 3.1.8 e 4.1.5), e [GHSA-jvvf-x445-j334](https://github.com/fastify/fast-uri/security/advisories/GHSA-jvvf-x445-j334), em 4.1.4 (patch 4.1.5). A instalação focada não alterou essas resoluções. A próxima manutenção deve revisar a cadeia AJV/Fastify e atualizar dentro dos ranges compatíveis, repetindo contratos e integrações; não há dispensa ou aceitação de risco aprovada. Todos os alertas residuais exigem atualização ou decisão explícita de risco antes do lançamento.

Validação focada executada pelo agente de manutenção: instalação offline imutável com `--frozen-lockfile` PASS; web lint/typecheck, 12 testes unitários e build de produção Next 16.3.6 PASS; API lint/typecheck, 32 testes unitários (incluindo os novos testes RNG do desenvolvimento paralelo) e build PASS; `git diff --check` PASS. Esses checks não são reprodução dos exploits, Verify independente final, matriz completa de browsers nem autorização de beta. Integrações, smoke e gates conjuntos devem ser repetidos pelo orquestrador após concluir as implementações paralelas; não atribuídos como executados por este agente.
