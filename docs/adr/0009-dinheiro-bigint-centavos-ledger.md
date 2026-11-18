# 0009. Dinheiro em centavos (`bigint`) com ledger de lançamentos

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** PERF-09, SEC-05, SEC-06

## Contexto

Float corrompe valores monetários. Saldo desnormalizado sem trilha de auditoria não permite reconciliação.

## Opções consideradas

1. **`numeric` com decimais**: exato, mas mais lento e com arredondamento a decidir em todo lugar
2. **Centavos inteiros (`bigint`) + ledger**

## Decisão

Valores em centavos inteiros: `bigint` no Postgres e no `Money`; `number` na borda JSON após `Number.isSafeInteger`. Tetos: transferência ≤ 100.000.000 e saldo inicial ≤ 10.000.000. `ledger_entries` (`OPENING`, `DEBIT`, `CREDIT`, `balance_after_cents`) registra cada movimento; teste de invariante `SUM(ledger) = balance_cents`.

## Consequências

- Positivas: aritmética exata; auditoria e reconciliação; extrato direto do ledger.
- Custos: conversão explícita na borda; `JSON.stringify` não aceita `BigInt`.
- Revisitar: multimoeda exigiria moeda por lançamento e escala por moeda.
