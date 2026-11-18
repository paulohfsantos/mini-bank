# Spec: Transferências (`TRF`)

- **Status:** Aprovada para implementação (fase 2)
- **Contrato:** [`openapi.yaml`](../openapi.yaml) → `POST /v1/transfers`, `GET /v1/transfers/{transferId}`; schemas `CreateTransferRequest`, `Transfer`, `Problem`
- **Evento produzido:** `transfer.completed` v1 (ver [`transfer-processing/spec.md`](../transfer-processing/spec.md))
- **ADRs:** 0004 (SQL puro), 0006 (outbox), 0008 (idempotência), 0009 (dinheiro)

## Contexto

Transferência síncrona entre duas contas: valida, debita e credita de forma atômica, registra a transferência como `COMPLETED`, grava os lançamentos do ledger e o evento no outbox, tudo no mesmo commit. É a operação crítica do sistema: precisa ser correta sob concorrência e segura contra retries.

## Regras de negócio

- **TRF-BR-01: Valor.** `amountCents` é inteiro, `1 ≤ amountCents ≤ 100_000_000` (R$ 1.000.000,00) (`SEC-06`).
- **TRF-BR-02: Contas distintas.** `sourceAccountId ≠ destinationAccountId`.
- **TRF-BR-03: Saldo suficiente.** O saldo da origem após o débito nunca fica negativo. O `CHECK (balance_cents >= 0)` no banco é a última linha de defesa.
- **TRF-BR-04: Atomicidade.** Débito, crédito, `transfers`, dois `ledger_entries` (`DEBIT` na origem, `CREDIT` no destino), linha no `outbox` e resposta de idempotência são gravados no mesmo commit, ou nada é gravado.
- **TRF-BR-05: Ordem de locks.** A transação trava primeiro a chave de idempotência e depois as duas contas com `SELECT ... FOR UPDATE` em ordem crescente de `id` (`PERF-08`).
- **TRF-BR-06: Timeouts.** Toda transação usa `lock_timeout = 2s` e `statement_timeout = 5s` (`PERF-06`).
- **TRF-BR-07: Idempotency-Key obrigatória.** Header `Idempotency-Key` de 1 a 64 caracteres `[A-Za-z0-9_-]` (UUID recomendado) (`SEC-10`).
- **TRF-BR-08: Escopo da chave.** A chave é única por cliente da API (`client_id`, derivado da API key) (`SEC-11`).
- **TRF-BR-09: Replay.** Mesma chave + mesmo payload (hash SHA-256 do JSON canônico) devolve a resposta original (mesmo status e corpo) com `Idempotent-Replayed: true`, sem nova transferência.
- **TRF-BR-10: Reuso indevido.** Mesma chave + payload diferente → `422 IDEMPOTENCY_KEY_REUSED`.
- **TRF-BR-11: Só sucesso consome a chave.** Apenas respostas `201` são armazenadas. Falhas (validação, conta inexistente, saldo insuficiente, timeouts) fazem rollback, inclusive da chave, e o cliente pode tentar de novo com a mesma chave. Motivo: armazenar falhas exigiria gravar fora da transação que sofreu rollback, e um cliente que repõe o saldo deve poder repetir a operação.
- **TRF-BR-12: Expiração.** Chaves expiram 24 h após a criação e são apagadas por job (`TRF-NFR-02`). Depois disso a mesma chave é tratada como nova.
- **TRF-BR-13: Ordem de validação.** (1) autenticação → (2) header `Idempotency-Key` → (3) schema do corpo → (4) `SAME_ACCOUNT` → (5) replay/reuso da chave → (6) existência das contas → (7) saldo.
- **TRF-BR-14: Correlation ID.** `x-correlation-id` válido (1 a 64 caracteres `[A-Za-z0-9-]`) é aceito; ausente ou inválido, a API gera um UUID. O valor é devolvido no header de resposta e gravado em `transfers.correlation_id` e no `outbox` (`SEC-12`).
- **TRF-BR-15: Evento.** Toda transferência concluída gera exatamente uma linha no `outbox` com `eventType = transfer.completed`.

## Critérios de aceite

### TRF-AC-01: Transferência válida
- **Dado** a conta A com saldo 100000 e a conta B com saldo 0
- **Quando** `POST /v1/transfers` com `{ sourceAccountId: A, destinationAccountId: B, amountCents: 15000 }` e uma `Idempotency-Key` nova
- **Então** `201` com `Transfer` (`status = COMPLETED`), header `Location: /v1/transfers/{id}`, saldo de A = 85000, saldo de B = 15000, um `DEBIT` de 15000 em A (`balanceAfterCents = 85000`) e um `CREDIT` em B (`balanceAfterCents = 15000`)
- Nível: e2e

### TRF-AC-02: Saldo insuficiente
- **Dado** a conta A com saldo 1000
- **Quando** transfere 1001
- **Então** `422 INSUFFICIENT_FUNDS` e nenhuma linha muda em `accounts`, `transfers`, `ledger_entries`, `outbox` ou `idempotency_keys`
- Nível: e2e + integração

### TRF-AC-03: Sem Idempotency-Key
- **Dado** uma requisição válida sem o header `Idempotency-Key`
- **Quando** `POST /v1/transfers`
- **Então** `400 IDEMPOTENCY_KEY_REQUIRED`
- Nível: e2e

### TRF-AC-04: Replay com a mesma chave e o mesmo payload
- **Dado** uma transferência concluída com a chave K
- **Quando** o mesmo payload é enviado de novo com a chave K
- **Então** a resposta tem o mesmo status (`201`) e o mesmo corpo da original, mais `Idempotent-Replayed: true`, e existe uma única transferência
- Nível: e2e

### TRF-AC-05: Mesma chave, payload diferente
- **Dado** uma transferência concluída com a chave K e `amountCents = 15000`
- **Quando** `POST` com a chave K e `amountCents = 20000`
- **Então** `422 IDEMPOTENCY_KEY_REUSED` e nada muda
- Nível: e2e

### TRF-AC-06: Mesma chave em paralelo
- **Dado** 10 requisições idênticas com a mesma chave K disparadas ao mesmo tempo
- **Quando** todas terminam
- **Então** existe exatamente uma transferência; as respostas de sucesso têm corpo idêntico; as demais são replays (`Idempotent-Replayed: true`) ou `409 REQUEST_IN_PROGRESS` (nunca uma segunda transferência)
- Nível: integração (Testcontainers) + e2e

### TRF-AC-07: Concorrência que excede o saldo
- **Dado** a conta A com saldo 10000
- **Quando** 50 transferências de 1000 de A para contas distintas, com chaves distintas, são disparadas em paralelo
- **Então** exatamente 10 terminam com `201`, as demais com `422 INSUFFICIENT_FUNDS` (ou `503 ACCOUNT_BUSY`), o saldo final de A é 0, nunca negativo, e `SUM(ledger) = balance_cents` para todas as contas
- Nível: integração

### TRF-AC-08: Mesma conta na origem e no destino
- **Dado** `sourceAccountId = destinationAccountId`
- **Quando** `POST /v1/transfers`
- **Então** `400 SAME_ACCOUNT`
- Nível: e2e

### TRF-AC-09: Conta inexistente
- **Dado** origem ou destino com UUID que não existe
- **Quando** `POST /v1/transfers`
- **Então** `404 ACCOUNT_NOT_FOUND`, com `detail` indicando qual papel (`source` ou `destination`) não foi encontrado
- Nível: e2e

### TRF-AC-10: Valor inválido
- **Dado** `amountCents` igual a 0, negativo, decimal, string ou acima de `100_000_000`
- **Quando** `POST /v1/transfers`
- **Então** `400 VALIDATION_ERROR` apontando `amountCents`
- Nível: e2e + unitário no schema

### TRF-AC-11: Falha no meio da transação
- **Dado** uma falha simulada depois do débito e antes do commit (ex.: erro ao gravar o outbox)
- **Quando** a transferência é processada
- **Então** rollback completo: saldos inalterados, nenhuma linha em `transfers`, `ledger_entries`, `outbox` ou `idempotency_keys`; resposta `500 INTERNAL_ERROR`
- Nível: integração

### TRF-AC-12: Correlation ID
- **Dado** `x-correlation-id: c-123` válido
- **Quando** a transferência é concluída
- **Então** a resposta traz `x-correlation-id: c-123` e o valor está em `transfers.correlation_id` e na linha do `outbox`
- **E** sem o header, ou com valor inválido (ex.: 65 caracteres, quebra de linha), a API gera um UUID e o usa da mesma forma
- Nível: e2e

### TRF-AC-13: Chave em uso por outra requisição
- **Dado** uma requisição com a chave K segurando o lock da chave por mais que o `lock_timeout` (simulado)
- **Quando** outra requisição com a chave K chega
- **Então** `409 REQUEST_IN_PROGRESS` com header `Retry-After`, e no fim existe no máximo uma transferência (`PERF-07`)
- Nível: integração

### TRF-AC-14: Conta disputada
- **Dado** a conta de origem travada por outra transação por mais que o `lock_timeout` (simulado)
- **Quando** uma transferência dessa conta chega
- **Então** `503 ACCOUNT_BUSY` com header `Retry-After` em até ~2,5 s, e nada muda (`PERF-06`)
- Nível: integração

### TRF-AC-15: A→B e B→A em paralelo
- **Dado** contas A e B com saldo suficiente
- **Quando** 20 transferências A→B e 20 B→A são disparadas em paralelo
- **Então** todas terminam (nenhum erro de deadlock `40P01`) e os saldos finais conferem com o ledger (`PERF-08`)
- Nível: integração

### TRF-AC-16: Idempotency-Key malformada
- **Dado** `Idempotency-Key` com mais de 64 caracteres ou caractere fora de `[A-Za-z0-9_-]`
- **Quando** `POST /v1/transfers`
- **Então** `400 IDEMPOTENCY_KEY_INVALID`
- Nível: e2e

### TRF-AC-17: Consultar transferência
- **Dado** uma transferência concluída
- **Quando** `GET /v1/transfers/{id}`
- **Então** `200` com o mesmo `Transfer` devolvido na criação
- **E** um UUID inexistente resulta em `404 TRANSFER_NOT_FOUND`
- Nível: e2e

### TRF-AC-18: Falha não consome a chave
- **Dado** uma transferência com a chave K que falhou com `422 INSUFFICIENT_FUNDS`
- **Quando** a conta de origem recebe uma transferência de entrada que cobre o valor e o mesmo payload é reenviado com a chave K
- **Então** a transferência é executada normalmente (`201`, sem `Idempotent-Replayed`)
- Nível: e2e

### TRF-AC-19: Evento no outbox
- **Dado** uma transferência concluída
- **Quando** o commit acontece
- **Então** existe exatamente uma linha em `outbox` com `event_type = 'transfer.completed'`, `published_at` nulo e payload válido contra `transfer.completed.v1.schema.json`
- Nível: integração

## Casos de erro

| Situação | Status | `code` | Headers |
|---|---|---|---|
| Sem/inválida `x-api-key` | 401 | `UNAUTHORIZED` | |
| Sem `Idempotency-Key` | 400 | `IDEMPOTENCY_KEY_REQUIRED` | |
| `Idempotency-Key` malformada | 400 | `IDEMPOTENCY_KEY_INVALID` | |
| Corpo inválido | 400 | `VALIDATION_ERROR` | |
| Origem = destino | 400 | `SAME_ACCOUNT` | |
| Conta não encontrada | 404 | `ACCOUNT_NOT_FOUND` | |
| Transferência não encontrada (GET) | 404 | `TRANSFER_NOT_FOUND` | |
| Chave em uso, espera > `lock_timeout` | 409 | `REQUEST_IN_PROGRESS` | `Retry-After` |
| Corpo > 16 KB | 413 | `PAYLOAD_TOO_LARGE` | |
| Mesma chave, payload diferente | 422 | `IDEMPOTENCY_KEY_REUSED` | |
| Saldo insuficiente | 422 | `INSUFFICIENT_FUNDS` | |
| Conta travada, espera > `lock_timeout` | 503 | `ACCOUNT_BUSY` | `Retry-After` |
| Erro inesperado | 500 | `INTERNAL_ERROR` | |

## Requisitos não funcionais

- **TRF-NFR-01:** `POST /v1/transfers` p95 < 300 ms no ambiente local com 20 req/s entre contas distintas.
- **TRF-NFR-02:** chaves de idempotência expiram em 24 h e são apagadas por job em lotes (`PERF-12`).
- **TRF-NFR-03:** nenhuma transação de escrita espera lock por mais de 2 s (`lock_timeout`) nem executa por mais de 5 s (`statement_timeout`).
- **TRF-NFR-04:** nenhuma chamada de rede (SQS, HTTP) acontece dentro da transação (`PERF-04`).

## Riscos relacionados

`SEC-06`, `SEC-10`, `SEC-11`, `SEC-12`, `PERF-06`, `PERF-07`, `PERF-08`, `PERF-09`, `PERF-10`.
