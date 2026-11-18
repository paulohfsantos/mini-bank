# 0016. Paginação do extrato por cursor (keyset)

- **Status:** Aceita
- **Data:** 2026-11-18
- **Relacionados:** STM-AC-01..05, PERF-14, SEC-16

## Contexto

O extrato cresce indefinidamente e recebe lançamentos novos enquanto o cliente pagina.

## Opções consideradas

1. **Offset/limit**: simples, mas degrada em páginas profundas e duplica ou pula itens com inserções
2. **Cursor por `(created_at, id)`**: usa índice e é estável

## Decisão

Cursor opaco base64url de `(created_at, id)`, decodificado com zod estrito; índice `(account_id, created_at desc, id desc)`. Limitação documentada: `created_at` é o início da transação, então um lançamento que commita depois com timestamp anterior pode não aparecer para quem já passou daquela posição. `STM-AC-05` garante apenas o que era visível na primeira página.

## Consequências

- Positivas: performance constante; sem duplicatas.
- Custos: sem "ir para a página N"; gap de visibilidade explicado.
- Revisitar: se o gap importar, usar uma sequência atribuída no commit (ex.: tabela de sequência serializada) ou watermark.
