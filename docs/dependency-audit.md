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
