# 0011. Logs JSON com pino e `correlationId` via AsyncLocalStorage

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** SEC-12, SEC-21, PERF-24

## Contexto

Investigar uma transferência exige ligar a requisição HTTP aos logs do worker, minutos depois, em outro processo.

## Opções consideradas

1. **Logger do Nest em texto**: legível, mas não consultável
2. **pino JSON + `correlationId` propagado por AsyncLocalStorage, outbox e message attribute**

## Decisão

pino (JSON, assíncrono) via `packages/observability`. `x-correlation-id` validado ou gerado, guardado em AsyncLocalStorage, gravado em `transfers`/`outbox` e enviado como message attribute. Logs incluem `traceId`. Uma linha por requisição, sem body, com redaction de `document`, `x-api-key` e `authorization`.

## Consequências

- Positivas: consultas no CloudWatch Logs Insights por `correlationId`; ligação com traces.
- Custos: disciplina de não logar PII.
- Revisitar: não previsto.
