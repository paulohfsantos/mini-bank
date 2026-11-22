# CLAUDE.md: mini-banco

Instruções para a IA (Claude Code) trabalhar neste repositório. Leia inteiro antes de qualquer tarefa.

## O projeto

Laboratório de contas e transferências que demonstra práticas de banco corporativo: NestJS 12 (ESM), Next.js, PostgreSQL com SQL puro, SQS com outbox, AWS via Terraform e **Spec-Driven Development**. Cada decisão precisa poder ser explicada em entrevista.

Documentos de referência (fonte de verdade, nesta ordem):

| Arquivo | Conteúdo |
|---|---|
| `specs/` | Specs por feature, `openapi.yaml`, schemas de eventos. **Comportamento vem daqui.** |
| `docs/plan.md` | Fases, tarefas, critérios de pronto. Diz em que fase estamos e o que vem a seguir |
| `docs/risks.md` | Riscos `SEC-xx` / `PERF-xx` e mitigações |
| `docs/adr/` | Decisões arquiteturais (não reabrir sem nova ADR) |
| `docs/README.md` | Domínio, arquitetura, modelo de dados, fluxos |
| `docs/aws.md` | Infraestrutura, IAM, custos |

## Arquitetura em uma tela

- `apps/api`: NestJS HTTP + `OutboxRelay`. Hexagonal por módulo: `domain/` (sem Nest, sem `pg`), `application/` (use cases + ports), `infrastructure/` (controllers, repositórios SQL, adapter SQS).
- `apps/worker`: NestJS standalone consumindo `transfer.completed` do SQS (antifraude + notificação).
- `apps/web`: Next.js App Router. A API key só existe no servidor (Server Components/Actions).
- `packages/contracts`: tipos gerados do OpenAPI + schemas zod + schema do evento.
- `packages/database`: pool `pg`, `withTransaction`, `UnitOfWork`, parser `int8` → `bigint`.
- `packages/observability`: pino, `correlationId`/`traceId` (AsyncLocalStorage), OpenTelemetry (SDK em `src/telemetry/`, carregado por `--import @mini-banco/observability/register`), `appMetrics` (catálogo fechado). `./testing`: `MemoryStream` (logs) e `startTestTelemetry` (spans/métricas em memória).
- `packages/messaging`: `createSqsClient` (timeouts, endpoint do ElasticMQ), `parseTraceparent`; `./testing`: ElasticMQ em container + fila/DLQ por teste (ADR-0024).
- `packages/config`: tsconfig base, ESLint, Prettier.
- `db/migrations/`: SQL puro (dbmate). `infra/`: Terraform (`bootstrap/` persistente, `envs/lab/` efêmero, `modules/`), CA bundle do RDS em `infra/certs/`. `Dockerfile` na raiz (targets `api` e `worker`, ARM64).

## Comandos

```bash
./start.sh                   # tudo de uma vez: pré-requisitos → install → infra → migrations → todos os testes → pnpm dev (--no-dev | --skip-tests | --keep-going; logs em .logs/)
pnpm install                 # instala (scripts de dependências bloqueados; ver allowBuilds)
pnpm infra:up                # docker compose: postgres, elasticmq (SQS), jaeger
pnpm infra:check             # verifica postgres, filas + DLQ e jaeger
pnpm infra:lint              # Terraform: fmt, validate (bootstrap + lab), terraform test (mock_provider, IDs de risco), tflint, trivy; em containers fixados, sem credenciais
./scripts/lab.sh bootstrap       # uma vez por conta (aprovação humana): state, OIDC, ECR, budget; 1ª vez com state local migrado para o S3
./scripts/lab.sh up|down|status  # sessão AWS (aprovação humana): apply com services em 0 → migration → services em 1 → smoke; down = destroy + session-end-check. Recusa sessão root
pnpm infra:down | infra:reset
pnpm lint | lint:fix
pnpm format | format:check
pnpm typecheck               # tsc --noEmit em cada pacote
pnpm build                   # swc em todos os pacotes (dist/)
pnpm dev                     # web (:3000) + api (:3001) + worker (health :3002): compila, recompila ao salvar, reinicia; logs via pino-pretty (LOG_PRETTY=false = JSON cru); traces no Jaeger (:16686), /metrics em :9464 (api) e :9465 (worker)
pnpm dev:web | dev:api | dev:worker  # só um deles
pnpm dlq:peek | dlq:redrive  # inspeciona a DLQ sem consumir | devolve as mensagens à fila (StartMessageMoveTask)
pnpm db:migrate              # dbmate up + db/schema.sql (db:rollback, db:new <nome>)
pnpm test                    # vitest (swc), projeto unit; pnpm test:watch em modo watch
pnpm test:integration        # Testcontainers: 1 Postgres + 1 ElasticMQ por execução; banco (TEMPLATE) e filas novos por arquivo
pnpm test:e2e                # Supertest na app completa + respostas validadas contra o openapi.yaml; inclui o teste de sistema de telemetria (builda e sobe api + worker do dist/)
pnpm test:web                # Playwright: next build + fluxo no navegador + varredura da key no .next/static (precisa de infra:up + db:migrate)
pnpm bench                   # medições de desempenho (PERF-18), fora do CI; resultado depende da máquina
pnpm specs:lint             # Spectral no openapi.yaml (falha em warn)
pnpm specs:coverage         # ACs das specs × testes que citam o ID; --require=<prefixos> torna obrigatório
pnpm contracts:generate     # regenera packages/contracts/src/generated/openapi.ts após mudar o openapi.yaml
pnpm contracts:check        # falha se os tipos gerados estiverem desatualizados
pnpm specs:check            # specs:lint + contracts:check + specs:coverage --require=ACC,TRF,STM,OBX,PRC,WEB,OBS
pnpm check                  # lint + format:check + typecheck + test + specs:check (rode antes de concluir)
```

Integração e e2e precisam do Docker (fora do `pnpm check`; o CI roda num job próprio). Testes rodam como `mini_banco_api`: um GRANT faltando aparece como `42501` no teste.

Mudou o `openapi.yaml`? Rode `pnpm contracts:generate` e ajuste o zod em `packages/contracts/src/schemas/`; `contract-alignment.ts` quebra o typecheck se os dois divergirem.

## Fluxo SDD (obrigatório)

1. **Leia a spec** da feature (`specs/<feature>/spec.md`) e o contrato antes de qualquer código. Sem spec, pare e proponha uma.
2. Mudança de comportamento segue a ordem: **spec → contrato → testes → código**.
3. Escreva os testes a partir dos critérios de aceite **antes** da implementação. O ID aparece no nome do teste:
   `it('[TRF-AC-06] mesma Idempotency-Key em paralelo gera uma única transferência', ...)`
4. Mitigações de risco também têm teste com o ID (`[PERF-08] ...`).
5. Decisão arquitetural nova ou alterada → ADR em `docs/adr/NNNN-titulo.md` (use `0000-template.md`).

## Como trabalhar numa tarefa

1. Identifique a fase e a tarefa em `docs/plan.md`. Não pule fases.
2. Decomponha em passos pequenos e verificáveis (um use case, um repositório, uma migration por vez).
3. Testes primeiro, depois implementação, depois `pnpm check`.
4. Não declare pronto com teste falhando, pulado (`.skip`/`.only`) ou com `pnpm check` vermelho.
5. Ao final, **liste o que precisa de revisão humana** (seção abaixo) e os IDs de AC/risco cobertos.
6. Atualize `docs/plan.md` (checkbox) e este arquivo se comandos ou convenções mudarem.

Escolha de modelo e agentes: use o modelo mais capaz para desenho, concorrência, SQL de lock, IAM e revisão; tarefas mecânicas (boilerplate, renomeações, fixtures) podem ir para modelo mais rápido. Subagentes servem para exploração, revisão de diff e rodar testes em paralelo; decisões de arquitetura ficam com o agente principal e com o humano.

## Convenções

### TypeScript
- `strict` + `noUncheckedIndexedAccess`. Proibido `any` (use `unknown` + validação). Proibido `console` (use o logger).
- TypeScript fixado em **6.0.x** via catálogo do pnpm (`pnpm-workspace.yaml`): o typescript-eslint ainda não suporta TS 7. Não atualize sem checar o peer range.
- **ESM em tudo** (`"type": "module"`; ADR-0023). Imports relativos **sem extensão** (`from './cpf'`, nunca `'./cpf.js'`; lint `no-restricted-imports`): o typecheck usa `moduleResolution: bundler` e o build com SWC (`resolveFully`) acrescenta `.js` na saída.
- `tsc` só checa tipos (`noEmit`); build é `swc`. Use `import.meta.dirname`, não `__dirname`. Pacotes do workspace expõem a condição `development` → `src/`.
- Tipos importados com `import type` (`verbatimModuleSyntax`).
- Promises sempre aguardadas (`no-floating-promises`); `void` explícito só com justificativa.

### Dinheiro
- Sempre **centavos inteiros**. `bigint` no Postgres e no `Money`; na borda JSON vira `number` após `Number.isSafeInteger` (`PERF-09`). **Nunca `float`**, nunca `parseFloat(x) * 100`.
- Tetos: transferência ≤ 100.000.000; saldo inicial ≤ 10.000.000.

### SQL (sem ORM; ADR-0004)
- Só queries parametrizadas (`$1, $2`). **Nunca** interpolar valores em SQL (`SEC-09`). Identificadores dinâmicos só via whitelist.
- Transações via `withTransaction`, que aplica `SET LOCAL lock_timeout = '2s'` e `statement_timeout = '5s'` (`PERF-06`).
- Ordem de locks: `idempotency_keys` → `accounts` por `id` crescente (`PERF-08`).
- Nada de chamada de rede (SQS, HTTP) dentro de transação (`PERF-04`).
- Migrations em `db/migrations/` (dbmate): `SET lock_timeout` no topo, `CREATE INDEX CONCURRENTLY` com `transaction:false`, expand/contract (`PERF-15`). IDs são UUIDv7 gerados na aplicação.

### API
- Erros em `application/problem+json` (RFC 9457) com `code` estável; erro desconhecido → 500 genérico + `correlationId`, sem mensagem do Postgres nem stack (`SEC-13`).
- Validação com zod (`packages/contracts`), `additionalProperties: false`, limites de tamanho.
- `x-correlation-id` validado (UUID ou ≤ 64 chars `[A-Za-z0-9-]`), senão gera um novo.

### Logs e telemetria
- pino JSON, uma linha por requisição, sem body. Redaction de `document`, `x-api-key`, `authorization` (`SEC-21`).
- Métricas só com dimensões de baixa cardinalidade, nunca `accountId`/`transferId` (`PERF-25`).

### Testes
- Unitário: Vitest (`*.spec.ts` ao lado do código, `import { describe, it, expect } from 'vitest'`, sem globals), use cases com fakes dos ports.
- Integração: Testcontainers com Postgres real (e fila real). E2E: Supertest + validação contra `openapi.yaml`.
- Dados de teste: CPFs gerados (válidos, mas falsos). Nunca dados reais.

### Git
- Conventional Commits, validado pelo commitlint; scopes em `commitlint.config.mjs`. Cite IDs: `feat(transfers): idempotency key [TRF-AC-04, TRF-AC-05]`.
- Hooks: pre-commit roda lint-staged (ESLint + Prettier); commit-msg roda commitlint.
- Markdown não passa pelo Prettier (`.prettierignore`).

### Dependências e supply chain (`SEC-32`)
- Scripts de instalação de dependências são bloqueados; liberar um pacote em `allowBuilds` exige justificativa no PR.
- `minimumReleaseAge` de 1 dia; actions do GitHub fixadas por **SHA** com comentário da versão.
- Versões de imagens Docker fixadas (sem `latest`).

## Proibido sem aprovação explícita do humano

- Mudar comportamento sem alterar a spec antes.
- Ampliar permissões IAM (sobretudo `*`, `iam:PassRole`) ou abrir security groups.
- Adicionar dependência nova sem dizer por quê, ou liberar build script.
- Desligar regra de lint, `strict` ou teste para "fazer passar".
- Commits, push, `terraform apply`/`destroy` ou qualquer ação na conta AWS.

## Checklist de revisão humana (a IA lista ao final de cada tarefa)

- [ ] SQL de lock, isolamento, ordem de locks e timeouts
- [ ] Migrations (locks, retrocompatibilidade)
- [ ] Tratamento de dinheiro (tipos, limites, arredondamento)
- [ ] Idempotência e comportamento sob concorrência
- [ ] Políticas IAM, security groups, secrets
- [ ] PII em logs, eventos, erros
- [ ] Desvios da spec ou do contrato
- [ ] Riscos de `docs/risks.md` tocados pela mudança

## Estado atual

- **Fases 0–5 concluídas** (fundação, specs, API, outbox + worker, front Next.js, observabilidade local). **Fase 6 (Terraform) com código pronto e validado estaticamente**; falta o setup da conta e o `terraform apply` (só com aprovação humana). Próxima: fase 7 (CI/CD com OIDC).
- Relay do outbox roda dentro da API com `OUTBOX_RELAY_ENABLED=true` (padrão `false`; testes da API o mantêm desligado). Worker: `apps/worker`, Nest standalone, papel `mini_banco_worker`.
- `createPool` registra listener de `error`: sem ele, uma conexão ociosa derrubada pelo servidor mata o processo.
- Pipeline HTTP (`apps/api/src/app.ts`): helmet → log/correlação → API key (antes do roteamento: 401 antes de 404) → body parser 16 KB → Nest → filtro `problem+json`. Validação com `parseOrThrow` (zod) no controller, na ordem de TRF-BR-13.
- Testes e2e usam `bodyOf(res)`/`httpServer(app)` (`apps/api/test/support`) porque o `res.body` do Supertest é `any`.
- Divergências intencionais entre `openapi.yaml` e zod (dígito verificador do CPF, trim do nome) estão listadas em `packages/contracts/src/contract.spec.ts`; nova divergência entra lá e na spec.
- Web (`apps/web`): a API key só é lida em `src/server/api.ts` (`import 'server-only'`; no Vitest `server-only` é um alias vazio). Server Actions validam tudo de novo em `src/server/*.ts`. Testes de componente: `*.spec.tsx` com `// @vitest-environment jsdom`. `next-env.d.ts` é gerado (gitignored).
- Telemetria (ADR-0025): só a API do OTel nos apps (`@mini-banco/observability`: `withConsumerSpan`, `withProducerSpan`, `currentTraceparent`, `appMetrics`); sem SDK tudo é no-op. Atributos de métrica só `reason`/`rule`/`outcome` (`PERF-25`). Chamada ao SQS que precisa preservar o `traceparent` do evento roda em `withoutAutoInstrumentation`. Instrumentação nova exige incluir o módulo em `INSTRUMENTED_MODULES` (loader ESM).
- AWS (fase 6): sem AWS CLI/Terraform locais; tudo roda em containers fixados (`scripts/infra-lint.sh`). Exceção do trivy só em `infra/.trivyignore.yaml`, com justificativa e restrita a um arquivo. `DB_SSL=verify-full` exige `DB_SSL_CA_FILE`. Migration na AWS = `node dist/migrate.js` na imagem da api (ADR-0026). Sessão: `scripts/lab.sh` (orquestra `push-images.sh`, `run-migration.sh`, `session-end-check.sh`). `desired_count` do lab não tem padrão: 0 até a migration rodar. Testes de infra em `infra/**/tests/*.tftest.hcl` com `mock_provider` e o ID do risco na `error_message`.
- SQS local é **ElasticMQ** (`:9324`), não LocalStack (ADR-0022). O endpoint vem de `AWS_ENDPOINT_URL`; na AWS a variável não existe e o SDK usa o SQS real.
