# CLAUDE.md: mini-banco

Instruções para a IA (Claude Code) trabalhar neste repositório. Leia inteiro antes de qualquer tarefa.

## O projeto

Laboratório de contas e transferências que demonstra práticas de banco corporativo: NestJS, Next.js, PostgreSQL com SQL puro, SQS com outbox, AWS via Terraform e **Spec-Driven Development**. Cada decisão precisa poder ser explicada em entrevista.

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
- `packages/observability`: pino, `correlationId` (AsyncLocalStorage), OpenTelemetry.
- `packages/config`: tsconfig base, ESLint, Prettier.
- `db/migrations/`: SQL puro (dbmate). `infra/`: Terraform (`bootstrap/` persistente, `envs/lab/` efêmero).

## Comandos

```bash
pnpm install                 # instala (scripts de dependências bloqueados; ver allowBuilds)
pnpm infra:up                # docker compose: postgres, elasticmq (SQS), jaeger
pnpm infra:check             # verifica postgres, filas + DLQ e jaeger
pnpm infra:down | infra:reset
pnpm lint | lint:fix
pnpm format | format:check
pnpm typecheck               # tsc --noEmit em cada pacote
pnpm test                    # jest (swc) em todo o monorepo
pnpm check                   # lint + format:check + typecheck + test (rode antes de concluir)
```

Ainda não existem (chegam nas fases 1–3): `pnpm specs:coverage`, `pnpm db:migrate`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm dev`.

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
- Imports relativos com extensão `.js` (NodeNext). Apps e pacotes Node são CommonJS.
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
- Unitário: Jest (`*.spec.ts` ao lado do código), use cases com fakes dos ports.
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

- **Fase 0 (fundação) concluída.** Próxima: fase 1 (specs e contratos).
- SQS local é **ElasticMQ** (`:9324`), não LocalStack (ADR-0022). O endpoint vem de `AWS_ENDPOINT_URL`; na AWS a variável não existe e o SDK usa o SQS real.
