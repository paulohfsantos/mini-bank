# Spec: Observabilidade (`OBS`)

- **Status:** Aprovada para implementação (fase 5)
- **Contrato:** [`openapi.yaml`](../openapi.yaml) (`/health/live`, `/health/ready`, schema `Health`); message attribute `traceparent` de [`transfer-processing/spec.md`](../transfer-processing/spec.md)
- **ADRs:** 0010 (OpenTelemetry, ADOT/X-Ray), 0011 (pino + `correlationId`)
- **Riscos:** `PERF-05`, `PERF-24`, `PERF-25`, `SEC-17`, `SEC-21`

## Contexto

Objetivo da fase: responder "o que aconteceu com a transferência X?" só com telemetria. Cada sinal tem um papel:

| Sinal | Pergunta que responde | Onde (local) |
|---|---|---|
| **Logs** (pino JSON) | O que aconteceu, com detalhe, nesta requisição/mensagem? | stdout |
| **Traces** (OpenTelemetry) | Por onde passou e quanto tempo levou cada etapa (HTTP → Postgres → SQS → worker)? | Jaeger `:16686` (OTLP) |
| **Métricas** (OTel Metrics) | Quanto, com que frequência, está piorando? | `/metrics` (Prometheus) |

O **`correlationId`** é o id de negócio que o cliente vê (header `x-correlation-id`); o **`traceId`** é o id técnico do trace. Os logs carregam os dois, e o span da requisição carrega o `correlationId` como atributo: dá para ir de um para o outro nos dois sentidos.

Na AWS (fases 6 e 8) o mesmo código exporta OTLP para o sidecar ADOT (X-Ray) e métricas via EMF; nada desta spec muda.

## Regras

### Traces
- **OBS-BR-01: Carregamento.** O SDK do OpenTelemetry é iniciado **antes** de qualquer módulo da aplicação (`node --import @mini-banco/observability/register`), com **só** as instrumentações `http`, `pg` e `aws-sdk`, sem o pacote de auto-instrumentações (`PERF-05`). A `instrumentation-nestjs-core` não suporta o Nest 12; o span de servidor recebe o nome da rota (`POST /v1/transfers`) e `http.route` de um interceptor da API (ADR-0025). `service.name` é `api` ou `worker`. Desligável com `OTEL_SDK_DISABLED=true`; endpoint por `OTEL_EXPORTER_OTLP_ENDPOINT` (padrão `http://localhost:4318`).
- **OBS-BR-02: Backend fora do ar não afeta o serviço.** Spans são exportados em lote, de forma assíncrona e com timeout. Jaeger/ADOT indisponível não derruba, não atrasa materialmente e não gera erro em requisições ou mensagens. No shutdown, flush com teto de 5 s.
- **OBS-BR-03: Propagação HTTP.** A API aceita `traceparent` (W3C Trace Context) de entrada e continua o trace; sem ele, inicia um novo. O span de servidor recebe o atributo `app.correlation_id`.
- **OBS-BR-04: Propagação pela fila.** Na transação da transferência, o `traceparent` do contexto ativo é gravado na linha do `outbox`. O relay envia **esse** valor como message attribute (o da requisição original, não o do próprio relay); o span do relay (`outbox publish`) tem *links* para os traces dos eventos do lote. O worker extrai o `traceparent` e abre o span `transfer.completed process` (kind `CONSUMER`) como **filho** do contexto da requisição original, com `app.correlation_id` e `messaging.message.id`. `traceparent` ausente ou malformado → trace novo, processamento normal.
- **OBS-BR-05: Sem PII nem segredos em spans.** Spans nunca contêm valores de parâmetros SQL, corpos de requisição/mensagem, headers `x-api-key`/`authorization`, CPF ou nome do titular (`SEC-21`). `db.statement` só com placeholders (`$1`).

### Logs
- **OBS-BR-06: Log ↔ trace.** Toda linha de log emitida com um span ativo traz `traceId` e `spanId` (hex, formato W3C), além do `correlationId` já existente (ADR-0011). Fora de span, os campos não aparecem.

### Métricas
- **OBS-BR-07: Catálogo.** Só estas métricas de aplicação (nomes como aparecem no Prometheus):

  | Métrica | Tipo | Atributos | Quando |
  |---|---|---|---|
  | `transfers_completed_total` | counter | (nenhum) | Após o commit de uma transferência nova (replay idempotente não conta) |
  | `transfers_rejected_total` | counter | `reason` = `code` do `problem+json` | `POST /v1/transfers` respondido com 4xx/5xx |
  | `outbox_pending` | gauge | (nenhum) | Linhas com `published_at IS NULL`, lido na coleta (consulta com timeout de 1 s; falha → sem observação) |
  | `outbox_publish_lag_ms` | histogram | (nenhum) | `now − created_at` de cada evento publicado com sucesso |
  | `fraud_flagged_total` | counter | `rule` (`HIGH_AMOUNT`, `HIGH_VELOCITY`) | Uma vez por regra disparada num `FLAGGED` |
  | `worker_processing_ms` | histogram | `outcome` (`processed`, `duplicate`, `retry`, `reject`) | Fim do processamento de cada mensagem |

  Mais as métricas padrão das instrumentações `http` (duração por método/status, sem URL).
- **OBS-BR-08: Cardinalidade.** Atributos de métrica só de conjuntos fechados (enum do contrato ou lista acima). **Nunca** `accountId`, `transferId`, `eventId`, `correlationId`, URL ou mensagem de erro (`PERF-25`). `service` vem do resource, não de atributo.
- **OBS-BR-09: Exposição.** Com `METRICS_PORT` definido, um exporter Prometheus serve `GET /metrics` numa porta própria (API `9464`, worker `9465`), só em `127.0.0.1`, fora do servidor HTTP da API: não passa pelo ALB nem pela API key. Sem `METRICS_PORT` (AWS), não há servidor de métricas; lá elas saem por EMF (fase 8).

### Saúde
- **OBS-BR-10: Health da API.** `GET /health/live`: `200 {"status":"ok"}` sem tocar em dependências. `GET /health/ready`: `200` se o Postgres responde `SELECT 1` em até 1 s **e**, com o relay habilitado, o loop do relay concluiu um ciclo (com ou sem eventos, com ou sem falha de envio) há menos de 30 s; senão `503 {"status":"error"}`. SQS fora do ar **não** tira a API de `ready`: o outbox existe para aceitar transferências nesse caso.
- **OBS-BR-11: Health do worker.** Servidor HTTP mínimo em `WORKER_HEALTH_PORT` (padrão `3002`) com as mesmas duas rotas. `ready` = Postgres (`SELECT 1` em até 1 s) **e** consumidor ativo: o último `ReceiveMessage` não falhou e começou há menos de 60 s. Qualquer outra rota → 404.
- **OBS-BR-12: Respostas de saúde sem detalhes.** Corpo só `{"status": "ok" | "error"}`, sem versões, hosts, nomes de dependências nem mensagens de erro, e com `Cache-Control: no-store` (`SEC-17`).
- **OBS-BR-13: Swagger só fora de produção.** Com `NODE_ENV=production`, `/docs` não é montado: responde como rota inexistente (401 sem key, `404 ROUTE_NOT_FOUND` com key) (`SEC-17`).

## Critérios de aceite

### OBS-AC-01: Trace completo de uma transferência
- **Dado** API (com relay) e worker rodando a partir do build (`dist/`) com o SDK carregado e exportando OTLP para um coletor de teste
- **Quando** uma transferência é criada com `x-correlation-id: c-obs-1`
- **Então** existe um único `traceId` com: span de servidor `POST` com `app.correlation_id = c-obs-1`, spans `pg` filhos, e o span `transfer.completed process` do worker (`service.name = worker`) como descendente do span da requisição
- **E** os logs do worker para esse evento trazem o mesmo `traceId` e o `correlationId` `c-obs-1`
- Nível: e2e

### OBS-AC-02: Relay repassa o traceparent original
- **Dado** uma linha no `outbox` com `traceparent` `00-<T>-<S>-01`
- **Quando** o relay a publica
- **Então** a mensagem no SQS tem o attribute `traceparent` igual ao gravado (não o do span do relay), e o span `outbox publish` tem um link para `<T>`
- Nível: integração

### OBS-AC-03: traceparent gravado no outbox
- **Dado** uma requisição `POST /v1/transfers` com `traceparent: 00-<T>-<S>-01`
- **Então** a linha do `outbox` tem um `traceparent` com trace id `<T>` e o parent id de um span da requisição (não `<S>`)
- **E** sem SDK ativo (`OTEL_SDK_DISABLED`), a coluna fica `NULL` e a transferência funciona igual
- Nível: integração

### OBS-AC-04: Worker continua o trace ou começa um novo
- **Dado** uma mensagem com `traceparent` válido
- **Então** o span `transfer.completed process` tem o mesmo trace id e o parent id do attribute
- **E dado** `traceparent` ausente, malformado ou com trace id zerado, o span é raiz de um trace novo e a mensagem é processada normalmente
- Nível: integração

### OBS-AC-05: traceId e spanId nos logs
- **Dado** um log emitido dentro de um span ativo
- **Então** a linha tem `traceId` (32 hex) e `spanId` (16 hex) iguais aos do span
- **E** fora de span, a linha não tem esses campos
- Nível: unitário

### OBS-AC-06: Spans sem PII nem segredos
- **Dado** o fluxo de OBS-AC-01, incluindo a criação das contas com CPF e nome
- **Então** nenhum atributo, evento ou nome de span exportado contém o CPF, o nome do titular, o valor da API key ou valores de parâmetros SQL
- Nível: e2e

### OBS-AC-07: Métricas de transferência
- **Dado** uma transferência bem-sucedida, um replay com a mesma `Idempotency-Key` e uma transferência com saldo insuficiente
- **Então** `transfers_completed_total` aumenta 1 e `transfers_rejected_total{reason="INSUFFICIENT_FUNDS"}` aumenta 1
- Nível: unitário + e2e

### OBS-AC-08: Métricas do outbox e do worker
- **Dado** eventos publicados pelo relay e processados pelo worker, um deles acima de R$ 10.000,00
- **Então** `outbox_publish_lag_ms` tem uma observação por evento publicado, `outbox_pending` reflete as linhas não publicadas, `worker_processing_ms{outcome="processed"}` conta cada mensagem e `fraud_flagged_total{rule="HIGH_AMOUNT"}` aumenta 1
- Nível: integração

### OBS-AC-09: Cardinalidade das métricas
- **Dado** todas as métricas exportadas depois do fluxo de OBS-AC-01
- **Então** nenhum atributo tem chave fora da lista de OBS-BR-07 e nenhum valor parece UUID
- Nível: e2e

### OBS-AC-10: /metrics em porta própria
- **Dado** a API com `METRICS_PORT`
- **Então** `GET /metrics` nessa porta responde texto Prometheus com as métricas de OBS-BR-07, e `GET /metrics` na porta da API responde como rota inexistente
- Nível: e2e

### OBS-AC-11: Health da API
- **Dado** a API com o Postgres disponível
- **Então** `/health/live` e `/health/ready` respondem `200 {"status":"ok"}` com `Cache-Control: no-store`
- **E dado** o Postgres indisponível, `/health/ready` responde `503 {"status":"error"}` e `/health/live` continua `200`
- **E dado** o relay habilitado sem ciclo concluído há 30 s, `/health/ready` responde `503`
- Nível: unitário + e2e

### OBS-AC-12: Health do worker
- **Dado** o worker rodando
- **Então** `:3002/health/live` e `:3002/health/ready` respondem `200 {"status":"ok"}`
- **E dado** o Postgres indisponível ou o último `ReceiveMessage` com falha, `ready` responde `503` e `live` continua `200`
- Nível: unitário + integração

### OBS-AC-13: Swagger desligado em produção
- **Dado** `NODE_ENV=production`
- **Então** `GET /docs` com API key válida responde `404 ROUTE_NOT_FOUND`
- **E** fora de produção continua `200`
- Nível: e2e

### OBS-AC-14: Coletor fora do ar
- **Dado** a API com o SDK apontando para um endpoint OTLP que recusa conexões
- **Então** criar conta e transferir respondem normalmente, sem erro no log de requisição
- Nível: e2e

## Requisitos não funcionais

- **OBS-NFR-01 (`PERF-05`):** medir o tempo de boot (processo iniciado → `api listening`) com e sem o SDK e registrar em `docs/plan.md`; o SDK não deve somar mais que 500 ms localmente.
- **OBS-NFR-02:** amostragem `parentbased_always_on` local; na AWS a taxa vem de `OTEL_TRACES_SAMPLER`/`OTEL_TRACES_SAMPLER_ARG` (fase 8), sem mudar código.

## Fora de escopo

Dashboards e alarmes (fase 8), EMF/CloudWatch e ADOT (fases 6 e 8), Prometheus/Grafana no compose, traces do Next.js (`apps/web` só propaga o `x-correlation-id`).
