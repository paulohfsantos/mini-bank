# Spec: Processamento assíncrono de transferências (`OBX` + `PRC`)

- **Status:** Aprovada para implementação (fase 3)
- **Contrato:** [`events/transfer.completed.v1.schema.json`](../events/transfer.completed.v1.schema.json)
- **ADRs:** 0006 (outbox com claim), 0007 (SQS Standard + DLQ), 0022 (ElasticMQ local)

## Contexto

Depois do commit de uma transferência, o evento `transfer.completed` sai do `outbox` para o SQS (relay dentro de `apps/api`) e é consumido pelo `apps/worker`, que faz uma análise antifraude simples e registra notificações simuladas. A entrega é **at-least-once**: o relay pode publicar duas vezes e o SQS Standard pode entregar duplicado, por isso o worker é idempotente.

## Contrato do evento

Corpo da mensagem: JSON válido contra `transfer.completed.v1.schema.json`.

```json
{
  "eventId": "0193a1b2-7c4d-7e5f-8a6b-1c2d3e4f5a6b",
  "eventType": "transfer.completed",
  "eventVersion": 1,
  "occurredAt": "2026-11-18T14:03:21.512Z",
  "correlationId": "c-123",
  "data": {
    "transferId": "0193a1b2-7c4d-7e5f-8a6b-000000000001",
    "sourceAccountId": "0193a1b2-7c4d-7e5f-8a6b-0000000000aa",
    "destinationAccountId": "0193a1b2-7c4d-7e5f-8a6b-0000000000bb",
    "amountCents": 15000,
    "completedAt": "2026-11-18T14:03:21.498Z"
  }
}
```

Message attributes (String): `eventType` (`transfer.completed`), `correlationId`, `traceparent` (W3C Trace Context; opcional).

Evolução: mudanças aditivas mantêm `eventVersion = 1`; consumidores ignoram campos desconhecidos. Mudança incompatível → `eventVersion = 2` com publicação dupla durante a migração.

O evento carrega apenas IDs e valores, nunca CPF ou nome (`SEC-21`).

## Regras de negócio

### Outbox / relay
- **OBX-BR-01: Claim.** Em transação curta, o relay marca até 10 linhas pendentes (`published_at IS NULL` e claim ausente ou expirado) com `claimed_until = now() + 30s`, escolhidas com `FOR UPDATE SKIP LOCKED` em ordem de `created_at`, e faz commit antes de chamar o SQS (`PERF-04`).
- **OBX-BR-02: Envio.** `SendMessageBatch` fora de transação, com timeout de 3 s; sucesso → `published_at = now()`; falha → `last_error` preenchido, `attempts` incrementado, e a linha volta a ser elegível quando o claim expira.
- **OBX-BR-03: Frequência.** Ciclo a cada 1 s, habilitado por `OUTBOX_RELAY_ENABLED`. No SIGTERM, para de fazer claims antes de fechar o pool.
- **OBX-BR-04: Limpeza.** Linhas publicadas há mais de 7 dias são apagadas em lotes, a cada hora (`PERF-12`).

### Worker
- **PRC-BR-01: Validação.** Corpo inválido contra o schema é erro **não retentável**.
- **PRC-BR-02: Idempotência.** `INSERT INTO processed_messages (consumer, event_id) ON CONFLICT DO NOTHING` na mesma transação dos efeitos; se a linha já existia, a mensagem é apagada sem novos efeitos.
- **PRC-BR-03: Confirmação no banco.** Antes de agir, o worker lê a transferência em `transfers`: precisa existir com as mesmas contas e o mesmo valor do evento. Divergência ou ausência é erro **não retentável** com log de segurança (`SEC-14`).
- **PRC-BR-04: Regra `HIGH_AMOUNT`.** `amountCents ≥ 1_000_000` (R$ 10.000,00).
- **PRC-BR-05: Regra `HIGH_VELOCITY`.** A conta de origem tem 5 ou mais transferências (incluindo a atual) com `created_at` na janela `[completedAt − 10 min, completedAt]`. A janela é relativa ao `completedAt` do evento, nunca a `now()` (`PERF-20`).
- **PRC-BR-06: Resultado.** Uma linha em `fraud_reviews` por transferência (`transfer_id` único): `FLAGGED` com a lista de `reasons` se alguma regra disparar, senão `CLEARED`. `rule_version = '2026-11-v1'`.
- **PRC-BR-07: Notificações.** Duas linhas em `notifications`, canal `LOG`: `TRANSFER_SENT` para a origem e `TRANSFER_RECEIVED` para o destino, mais um log estruturado por notificação.
- **PRC-BR-08: Confirmação.** `DeleteMessage` só depois do commit.
- **PRC-BR-09: Erros.** Não retentável → `ChangeMessageVisibility(0)`, para esgotar rápido o `maxReceiveCount = 5` e ir para a DLQ. Retentável (banco indisponível, timeout) → backoff exponencial via `ChangeMessageVisibility` (5 s, 10 s, 20 s, ...).
- **PRC-BR-10: Contexto.** Todo log do processamento traz o `correlationId` do message attribute (ou do corpo) e o `traceId` derivado do `traceparent`.

## Critérios de aceite

### OBX-AC-01: Publicação após o commit
- **Dado** uma transferência concluída e o relay ativo
- **Quando** passam até 5 s
- **Então** existe uma mensagem na fila com corpo válido contra o schema e attributes `eventType` e `correlationId`, e a linha do `outbox` tem `published_at` preenchido
- Nível: integração (Postgres + ElasticMQ)

### OBX-AC-02: Fila indisponível
- **Dado** a fila fora do ar
- **Quando** transferências são concluídas
- **Então** as linhas ficam pendentes com `attempts` crescendo e `last_error` preenchido; quando a fila volta, todas são publicadas
- Nível: integração

### OBX-AC-03: Duas instâncias do relay
- **Dado** dois relays rodando ao mesmo tempo sobre 100 linhas pendentes
- **Quando** ambos completam seus ciclos
- **Então** nenhuma linha é reivindicada pelos dois no mesmo ciclo e as 100 são publicadas
- Nível: integração

### OBX-AC-04: SQS lento não segura a transação
- **Dado** um cliente SQS que demora 10 s para responder (simulado)
- **Quando** o relay roda enquanto transferências chegam
- **Então** não há transação aberta nem lock em `outbox` durante o envio e `POST /v1/transfers` continua dentro do `TRF-NFR-01` (`PERF-04`)
- Nível: integração

### OBX-AC-05: Relay cai depois do claim
- **Dado** um relay que reivindicou linhas e morreu antes de enviar
- **Quando** `claimed_until` expira
- **Então** outro ciclo reivindica e publica as mesmas linhas
- Nível: integração

### PRC-AC-01: Evento válido abaixo dos limites
- **Dado** um evento válido de 15000 centavos de uma origem sem outras transferências recentes
- **Quando** o worker processa
- **Então** `fraud_reviews` tem `CLEARED` para a transferência, `notifications` tem `TRANSFER_SENT` (origem) e `TRANSFER_RECEIVED` (destino), e a mensagem é apagada
- Nível: integração

### PRC-AC-02: Valor alto
- **Dado** um evento com `amountCents = 1_000_000`
- **Quando** o worker processa
- **Então** `fraud_reviews.status = FLAGGED` com `reasons = ['HIGH_AMOUNT']`
- **E** com `amountCents = 999_999` o resultado é `CLEARED`
- Nível: unitário (`HighAmountRule`) + integração

### PRC-AC-03: Muitas transferências em pouco tempo
- **Dado** 4 transferências da origem A nos últimos 10 minutos antes de `completedAt`
- **Quando** o worker processa a 5ª
- **Então** `FLAGGED` com `HIGH_VELOCITY`
- **E** o resultado é o mesmo se o evento for processado com 1 h de atraso, e uma transferência 10 min + 1 s antes do `completedAt` não conta (`PERF-20`)
- Nível: unitário (`HighVelocityRule`) + integração

### PRC-AC-04: Evento duplicado
- **Dado** o mesmo evento entregue duas vezes (mesmo `eventId`)
- **Quando** o worker processa ambos
- **Então** existe uma linha em `fraud_reviews`, duas em `notifications` (não quatro), e as duas mensagens são apagadas
- Nível: integração

### PRC-AC-05: Mensagem malformada
- **Dado** uma mensagem com corpo `{"foo":1}` ou JSON inválido
- **Quando** o worker a recebe
- **Então** nada é gravado, um log `ERROR` com os erros de validação é emitido, e após 5 recebimentos a mensagem está na DLQ
- Nível: integração

### PRC-AC-06: Falha transitória
- **Dado** o Postgres indisponível durante o processamento
- **Quando** o worker recebe um evento válido
- **Então** a mensagem não é apagada, volta com backoff, e é processada com sucesso quando o banco volta (dentro de 5 recebimentos)
- Nível: integração

### PRC-AC-07: Correlation ID nos logs
- **Dado** uma transferência criada com `x-correlation-id: c-123`
- **Quando** o worker processa o evento
- **Então** todos os logs do processamento trazem `correlationId = "c-123"`
- Nível: integração (captura dos logs)

### PRC-AC-08: Evento sem transferência correspondente
- **Dado** um evento válido no schema cujo `transferId` não existe em `transfers`, ou cujo valor/contas divergem da linha do banco
- **Quando** o worker processa
- **Então** nenhum efeito é gravado, um log `ERROR` de segurança é emitido e a mensagem vai para a DLQ (`SEC-14`)
- Nível: integração

## Requisitos não funcionais

- **PRC-NFR-01:** p95 do processamento de um evento < 200 ms (ambiente local), o que define o visibility timeout de 30 s com folga ≥ 6× (`PERF-18`).
- **PRC-NFR-02:** o worker processa o lote com concorrência limitada (≤ 5), abaixo do tamanho do pool do banco (`PERF-17`).
- **PRC-NFR-03:** no SIGTERM, o worker cancela o long polling e termina o lote em andamento antes do `stopTimeout` (`PERF-19`).

## Riscos relacionados

`SEC-14`, `SEC-21`, `SEC-22`, `PERF-04`, `PERF-12`, `PERF-16`, `PERF-17`, `PERF-18`, `PERF-19`, `PERF-20`.
