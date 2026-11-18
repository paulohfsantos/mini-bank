# 0007. SQS Standard com DLQ

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** ADR-0006, PRC-AC-04, PRC-AC-05

## Contexto

O worker processa `transfer.completed` para antifraude e notificação. Cada evento é independente; o consumer já precisa ser idempotente por causa do outbox.

## Opções consideradas

1. **SQS FIFO**: ordem por grupo e deduplicação de 5 min, mas throughput menor e a dedup não protege o efeito colateral do consumer
2. **SQS Standard + DLQ**: at-least-once, sem ordem, simples e barato

## Decisão

SQS Standard com DLQ (`maxReceiveCount = 5`), visibility timeout 30 s, long polling 20 s, SSE-SQS. Erros não-retentáveis zeram a visibilidade para chegar rápido à DLQ; transitórios usam backoff via `ChangeMessageVisibility`. Redrive é ação humana.

## Consequências

- Positivas: modelo simples; a idempotência (`processed_messages`) resolve duplicatas.
- Custos: sem ordem; a regra de velocidade usa timestamps do evento, não a ordem de chegada.
- Revisitar: se surgir regra que dependa de ordem estrita por conta.
