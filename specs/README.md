# Specs: mini-banco

Fonte de verdade do **comportamento** do sistema. O código implementa o que está aqui; se o código e a spec divergem, o código está errado (ou a spec precisa mudar primeiro).

| Arquivo | Escopo |
|---|---|
| [`accounts/spec.md`](accounts/spec.md) | Criar e consultar contas (`ACC`) |
| [`transfers/spec.md`](transfers/spec.md) | Transferência síncrona, idempotência, concorrência (`TRF`) |
| [`statement/spec.md`](statement/spec.md) | Extrato paginado (`STM`) |
| [`transfer-processing/spec.md`](transfer-processing/spec.md) | Outbox (`OBX`) e worker: antifraude e notificação (`PRC`) |
| [`web/spec.md`](web/spec.md) | Front Next.js: telas, Server Actions, segredo só no servidor (`WEB`) |
| [`openapi.yaml`](openapi.yaml) | Contrato REST (OpenAPI 3.1) |
| [`events/transfer.completed.v1.schema.json`](events/transfer.completed.v1.schema.json) | Contrato do evento assíncrono (JSON Schema 2020-12) |

## Convenções de IDs

| Prefixo | Significado | Exemplo |
|---|---|---|
| `<FEAT>-BR-nn` | Regra de negócio | `TRF-BR-03` |
| `<FEAT>-AC-nn` | Critério de aceite (Dado/Quando/Então). **Cada um tem ao menos um teste que cita o ID.** | `TRF-AC-06` |
| `<FEAT>-NFR-nn` | Requisito não funcional | `TRF-NFR-01` |
| `SEC-nn` / `PERF-nn` | Risco de [`docs/risks.md`](../docs/risks.md) | `PERF-07` |

- Critérios de aceite são declarados como título de nível 3: `### TRF-AC-06: ...`. O script `pnpm specs:coverage` lê esse formato.
- IDs nunca são reutilizados. Um critério removido fica marcado como `~~removido~~` com o motivo.
- Cada critério indica o **nível de teste** esperado: unitário, integração (Testcontainers) ou e2e (Supertest).

## Ciclo de mudança

1. Alterar a spec (regra, critério, erro) e o contrato no mesmo PR.
2. Escrever ou ajustar os testes que citam os IDs.
3. Só então o código.
4. A revisão começa pelo diff da spec.

## Convenções de contrato

- Dinheiro sempre em **centavos inteiros** (`*Cents`), nunca decimal.
- IDs são UUID (v7, gerados pela aplicação).
- Datas em ISO 8601 UTC (`date-time`).
- Erros em `application/problem+json` (RFC 9457) com `code` estável; o front mapeia mensagens pelo `code`, não pelo texto.
- Corpos de requisição rejeitam campos desconhecidos. Consumidores de eventos ignoram campos desconhecidos (evolução aditiva).

## Erros transversais (valem para toda a API)

| Situação | Status | `code` |
|---|---|---|
| Rota ou método inexistente | 404 | `ROUTE_NOT_FOUND` |
| JSON malformado no corpo | 400 | `VALIDATION_ERROR` |
| Corpo > 16 KB | 413 | `PAYLOAD_TOO_LARGE` |
| Erro inesperado | 500 | `INTERNAL_ERROR`, só com `correlationId`, sem mensagem interna nem stack (`SEC-13`) |
| `409 REQUEST_IN_PROGRESS` e `503 ACCOUNT_BUSY` | | sempre com `Retry-After` (segundos) |

A autenticação vem antes do roteamento de recursos: uma rota inexistente sem `x-api-key` válida responde `401`, para não revelar quais rotas existem.
