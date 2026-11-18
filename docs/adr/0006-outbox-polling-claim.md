# 0006. Transactional Outbox com polling, claim e envio fora da transação

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** PERF-04, PERF-12, PERF-16, OBX-AC-01..05

## Contexto

A transferência precisa gerar `transfer.completed` de forma confiável. Publicar antes do commit pode emitir evento de algo que sofreu rollback; publicar depois pode perder o evento se o processo cair (dual write).

## Opções consideradas

1. **Enviar ao SQS dentro do handler**: simples e incorreto
2. **Outbox + CDC (Debezium lendo o WAL)**: latência baixa, mas pesado e caro para o lab
3. **Outbox + polling com `FOR UPDATE SKIP LOCKED` segurando a transação durante o envio**: simples, mas um SQS lento prende conexões e locks
4. **Outbox + polling com claim (`claimed_until`) e envio fora da transação**

## Decisão

Outbox com claim: transação curta faz `UPDATE ... SET claimed_until = now() + 30s` nas linhas escolhidas com `FOR UPDATE SKIP LOCKED`, commit; envio por `SendMessageBatch` fora da transação (timeout de 3 s); depois `published_at`. Claim expirado volta a ser elegível. O relay roda dentro de `apps/api`, a cada 1 s. Job de limpeza apaga publicados > 7 dias.

## Consequências

- Positivas: atomicidade entre negócio e evento; nenhuma conexão presa em rede; múltiplas instâncias seguras.
- Custos: entrega at-least-once (consumer precisa ser idempotente); latência de até ~1 s.
- Revisitar: se a latência importar, `LISTEN/NOTIFY` para acordar o relay; em escala, CDC.
