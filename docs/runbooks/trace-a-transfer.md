# Runbook: o que aconteceu com a transferência X?

Objetivo: partir de um `x-correlation-id` (ou de um `transferId`) e reconstruir o caminho HTTP → Postgres → outbox → SQS → worker só com telemetria. Spec: [`specs/observability/spec.md`](../../specs/observability/spec.md).

## 0. Pré-requisitos (local)

```bash
pnpm infra:up && pnpm db:migrate
pnpm dev            # api :3001 (/metrics :9464), worker (health :3002, /metrics :9465), web :3000
```

Jaeger: <http://localhost:16686>. O SDK entra por `--import @mini-banco/observability/register` (`pnpm dev`/`pnpm start`); `OTEL_SDK_DISABLED=true` desliga.

## 1. Pegue um identificador

| Você tem | De onde vem |
|---|---|
| `correlationId` | Header `x-correlation-id` da resposta; mensagem de erro genérica do front ("código para suporte"); `correlationId` no `problem+json` |
| `transferId` | URL do comprovante (`/transfers/{id}`), corpo do `201`, header `location` |
| `traceId` | Campo `traceId` de qualquer linha de log dentro de uma requisição ou mensagem |

## 2. Ache o trace

**Pelo `correlationId`** (o caminho mais comum): Jaeger → *Search* → Service `api` → Tags `app.correlation_id=<id>` → *Find Traces*.

**Pelo log**: a linha `request completed` da API tem `correlationId`, `traceId` e `spanId`:

```bash
# pnpm dev com LOG_PRETTY=false para JSON cru
LOG_PRETTY=false pnpm dev:api | grep '"correlationId":"c-123"'
```

Cole o `traceId` em Jaeger → *Search* → *Trace ID*.

**Pelo `transferId`**: as linhas do worker têm `transferId`, `correlationId` e `traceId` (`transfer.completed processed`).

## 3. Leia o trace

Um trace saudável tem, nesta ordem:

| Span | Serviço | O que mostra |
|---|---|---|
| `POST /v1/transfers` (SERVER) | api | `app.correlation_id`, `http.route`, status, duração total |
| `pg-pool.connect`, `pg.query:*` | api | Cada query (só com placeholders `$1`), tempo de espera por conexão (`PERF-02`) |
| `transfer.completed process` (CONSUMER) | worker | Filho do span `POST`. `app.decision` = `delete` / `retry` / `reject`, `messaging.message.id` |
| `pg.query:*` e spans do SQS | worker | Dedupe, leitura da transferência, antifraude, notificações e o `DeleteMessage`/`ChangeMessageVisibility` |

A distância entre o fim do `POST` e o início do `transfer.completed process` é a latência assíncrona: relay (ciclo de 1 s) + fila. O span `outbox publish` do relay fica num trace próprio (um lote mistura eventos de várias requisições) com **link** para o trace da requisição: no Jaeger, abra o span e siga *References*.

## 4. Se algo faltar

| Sintoma | Onde olhar |
|---|---|
| Só o span `POST`, nada do worker | `outbox`: `SELECT published_at, attempts, last_error FROM outbox WHERE aggregate_id = '<transferId>'`. `published_at` nulo → relay (`/health/ready` da API, log `outbox publish failed`). Publicado → fila/DLQ (`pnpm dlq:peek`) e `:3002/health/ready` do worker |
| Worker com `app.decision=retry` | Log `transient failure; retrying with backoff` com o mesmo `traceId`; cada nova entrega gera outro span `transfer.completed process` no mesmo trace |
| `app.decision=reject` | Mensagem foi para a DLQ: log `invalid message` ou `event does not match stored transfer` (`security: true`, `SEC-14`) |
| `transfer.completed process` em trace separado | Mensagem sem `traceparent` (ex.: redrive manual, evento antigo); procure pelo `correlationId` |
| Nenhum trace | SDK desligado (`OTEL_SDK_DISABLED`), Jaeger fora do ar (o serviço segue normal, OBS-BR-02) ou requisição em `/health`/`/metrics` (não rastreadas de propósito) |

## 5. Métricas que ajudam

```bash
curl -s localhost:9464/metrics | grep -E '^(transfers_|outbox_)'
curl -s localhost:9465/metrics | grep -E '^(worker_|fraud_)'
```

| Pergunta | Métrica |
|---|---|
| Transferências estão sendo rejeitadas? Por quê? | `transfers_rejected_total{reason}` |
| O relay está atrasado? | `outbox_pending` (backlog) e `outbox_publish_lag_ms` (p95/p99 pelos buckets) |
| O worker está lento ou retentando? | `worker_processing_ms{outcome}` |
| Antifraude disparando mais que o normal? | `fraud_flagged_total{rule}` |

Métricas nunca têm `accountId`/`transferId` (`PERF-25`): servem para ver **que** algo mudou; o trace e os logs dizem **com quem**.

## 6. Saúde

```bash
curl -i localhost:3001/health/live    # processo vivo (não toca dependências)
curl -i localhost:3001/health/ready   # Postgres em 1 s + relay com ciclo há < 30 s
curl -i localhost:3002/health/ready   # worker: Postgres + último ReceiveMessage ok há < 60 s
```

SQS fora do ar **não** derruba o `ready` da API: o outbox guarda os eventos e o relay publica quando a fila voltar.

## Na AWS (fases 6 e 8)

Mesmo código: traces OTLP → sidecar ADOT → X-Ray (para buscar por `app.correlation_id`, o ADOT precisa indexá-lo como anotação; configurar na fase 8); logs no CloudWatch Logs Insights:

```
fields @timestamp, service, msg, traceId, transferId
| filter correlationId = 'c-123'
| sort @timestamp asc
```
